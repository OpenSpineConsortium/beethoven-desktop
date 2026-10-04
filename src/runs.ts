// Every worker of the student's grid account, from each one's own status file: <state_dir>/<name>/status.json
// and no other file of a run folder (job.token, job.sbatch, the launch files and the job's output are
// never opened). The browser edition watches the same file the same way (the server repository's
// docs/V11_CONTRACT.md, section 12). A worker started from another computer, another edition or a
// teammate's job is listed too, so nothing runs in the student's name unseen, and each row says which
// Claude account the worker reported (Claude Code's own `auth status`, never a credential).
import { isClaudeCodeLink, WORKER_NAME_RE } from './contract.js';
import { SftpError, type Sftp } from './sftp.js';
import { WorkspaceError } from './workspace.js';

export const MAX_WORKERS = 100;
const MAX_STATUS = 64 * 1024;

export interface WorkerRow {
  name: string;
  /** the job's own word (queued, starting, need_login, need_consent, running, online, stopped, preempted, error), or "unreadable" */
  state: string;
  node: string;
  job: string;
  next_job: string;
  /** the Claude account the worker reported, as Claude Code named it; "" when it named none */
  claude_account: string;
  claude_plan: string;
  claude_signed_in: boolean | null;
  online_at: string;
  ends_at: string;
  updated_at: string;
  link: string | null;
}

/** a value the job wrote, as short plain text: the worker can write this file, so nothing in it is trusted further */
function word(v: unknown, max = 120): string {
  return typeof v === 'string' ? v.replace(/[\x00-\x1f\x7f]/g, ' ').slice(0, max) : '';
}

export function rowOf(name: string, text: string | null): WorkerRow {
  let j: Record<string, unknown> | null = null;
  try {
    const p = text === null ? null : (JSON.parse(text) as unknown);
    if (p && typeof p === 'object' && !Array.isArray(p)) j = p as Record<string, unknown>;
  } catch {
    // a file in the middle of being written is replaced whole (status.json.part, then rename), so this is rare
  }
  const cl = j && typeof j.claude_login === 'object' && j.claude_login ? (j.claude_login as Record<string, unknown>) : null;
  const link = j ? [j.environment_url, j.session_url].find(isClaudeCodeLink) ?? null : null;
  return {
    name,
    state: j ? word(j.state, 32) || 'unknown' : 'unreadable',
    node: j ? word(j.node, 64) : '',
    job: j ? word(j.job, 32) : '',
    next_job: j ? word(j.next_job, 32) : '',
    claude_account: cl ? word(cl.email, 254) : '',
    claude_plan: cl ? word(cl.subscriptionType, 32) : '',
    claude_signed_in: cl && typeof cl.loggedIn === 'boolean' ? cl.loggedIn : null,
    online_at: j ? word(j.online_at, 32) : '',
    ends_at: j ? word(j.ends_at, 32) : '',
    updated_at: j ? word(j.updated_at, 32) : '',
    link,
  };
}

export async function listWorkers(sftp: Sftp, stateDir: string): Promise<{ workers: WorkerRow[]; truncated: boolean }> {
  let root: string;
  try {
    root = await sftp.realpath(stateDir);
  } catch (e) {
    if (e instanceof SftpError && e.missing) return { workers: [], truncated: false };
    if (e instanceof SftpError && e.denied) throw new WorkspaceError('denied', "The grid refused to show this account's workers.");
    throw e;
  }
  // READDIR's kinds come from lstat on the grid, so a run folder that is a link is not a run folder
  const entries = await sftp.readdir(root, MAX_WORKERS + 50);
  const names = entries
    .filter((e) => e.kind === 'dir' && e.name !== 'workspaces' && WORKER_NAME_RE.test(e.name))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b));
  const workers: WorkerRow[] = [];
  let truncated = entries.length >= MAX_WORKERS + 50;
  for (const name of names) {
    if (workers.length >= MAX_WORKERS) {
      truncated = true;
      break;
    }
    const file = `${root}/${name}/status.json`;
    let st;
    try {
      st = await sftp.lstat(file);
    } catch (e) {
      if (e instanceof SftpError && (e.missing || e.denied)) continue; // a folder that is not a worker's
      throw e;
    }
    if (st.mode === undefined || (st.mode & 0o170000) !== 0o100000) {
      workers.push(rowOf(name, null));
      continue;
    }
    try {
      const { data } = await sftp.readFile(file, MAX_STATUS, (a) => {
        if (a.mode === undefined || (a.mode & 0o170000) !== 0o100000) throw new WorkspaceError('changed', 'not a plain file');
      });
      workers.push(rowOf(name, data.toString('utf8')));
    } catch (e) {
      if (e instanceof WorkspaceError || (e instanceof SftpError && (e.missing || e.denied))) workers.push(rowOf(name, null));
      else throw e;
    }
  }
  return { workers, truncated };
}

// The tools, exactly: twelve, each a fixed request with checked arguments. There is no tool that runs a
// command of the model's choosing, takes a path outside the worker's workspace, or takes a password, a
// code, a key or a token; the student's sign-in happens in their own terminal. Every result passes a
// redactor before the model sees it. The annotations say truthfully what each tool does.
import { describeAccounts, readAccounts, registryDir } from './accounts.js';
import { linkOf, PERMISSION_MODES, type PermissionMode, type StatusJson, type Step } from './contract.js';
import type { Grid, Outcome } from './grid.js';
import type { WorkerRow } from './runs.js';
import { ArgError, type Tool, type ToolResult } from './mcp.js';
import { redact } from './redact.js';
import { DEFAULT_READ, MAX_READ } from './workspace.js';

function result(text: string, structured?: Record<string, unknown>, isError = false): ToolResult {
  const r: ToolResult = { content: [{ type: 'text', text: redact(text) }] };
  if (structured) r.structuredContent = JSON.parse(redact(JSON.stringify(structured))) as Record<string, unknown>;
  if (isError) r.isError = true;
  return r;
}

function failed(o: { ok: false; message: string }): ToolResult {
  return result(o.message, undefined, true);
}

const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

// ---- arguments ----------------------------------------------------------------------------------------

function only(args: Record<string, unknown>, allowed: string[]): void {
  for (const k of Object.keys(args)) if (!allowed.includes(k)) throw new ArgError(`This tool takes no "${k}".`);
}
function optString(args: Record<string, unknown>, k: string): string | undefined {
  const v = args[k];
  if (v === undefined || v === null || v === '') return undefined;
  if (typeof v !== 'string') throw new ArgError(`"${k}" must be text.`);
  return v;
}
function optInt(args: Record<string, unknown>, k: string, min: number, max: number): number | undefined {
  const v = args[k];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) throw new ArgError(`"${k}" must be a whole number from ${min} to ${max}.`);
  return v;
}
function optBool(args: Record<string, unknown>, k: string): boolean | undefined {
  const v = args[k];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'boolean') throw new ArgError(`"${k}" must be true or false.`);
  return v;
}

const NAME_PROP = {
  name: {
    type: 'string',
    description: "The worker's name; leave it out for the one named in Beethoven's settings (usually \"worker\").",
    pattern: '^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$',
  },
};

function schema(props: Record<string, unknown>, required: string[] = []): Record<string, unknown> {
  return { type: 'object', properties: props, required, additionalProperties: false };
}

// ---- words about a worker -------------------------------------------------------------------------------

export function describeStatus(s: StatusJson, asOf: number, nextAt: number, cached: boolean, title: string, sharedInstall: string): { text: string; structured: Record<string, unknown> } {
  const st = s.status ?? {};
  const state = st.state ?? 'unknown';
  const link = linkOf(s);
  const lines = [`Worker "${s.run}" on the ${title}: ${state}.`, s.line];
  if (link) lines.push(`Claude link: ${link} (open_in_claude opens it in the browser).`);
  const cl = st.claude_login;
  if (cl && typeof cl.loggedIn === 'boolean') {
    lines.push(cl.loggedIn ? `Signed in to Claude on the grid as ${cl.email || 'an account Claude Code did not name'}${cl.subscriptionType ? ` (${cl.subscriptionType})` : ''}, checked ${cl.checked_at ?? 'at an unknown time'}.` : 'Not signed in to Claude on the grid.');
  }
  // the Claude sign-in is the student's own, at their own terminal; this edition only names the line
  const login = `bash ${sharedInstall}/bin/hpcworker claude login`;
  if (state === 'need_login') lines.push(`To sign the worker in to Claude, run this yourself in the grid terminal (grid_sign_in opens one); Beethoven never runs it:\n  ${login}`);
  if (state === 'need_consent') lines.push(`Remote Control's answer isn't on record for this account. Run this once yourself in the grid terminal; Claude Code asks its own question there:\n  ${login}`);
  const facts: string[] = [];
  if (s.job) facts.push(`job ${s.job}`);
  if (st.node) facts.push(`on ${st.node}`);
  if (st.ends_at) facts.push(`renews itself at ${st.ends_at}`);
  if (s.next_job) facts.push(`next job ${s.next_job} queued`);
  if (s.scheduler?.reason) facts.push(`the scheduler says ${s.scheduler.reason}${s.scheduler.expected_start ? `, expected start ${s.scheduler.expected_start}` : ''}`);
  if (facts.length) lines.push(facts.join('; ') + '.');
  lines.push(cached ? `As of ${iso(asOf)}; Beethoven asks the grid again after ${iso(nextAt)}.` : `Read from the grid at ${iso(asOf)}.`);
  return {
    text: lines.join('\n'),
    structured: {
      name: s.run,
      state,
      line: s.line,
      link,
      job: s.job,
      next_job: s.next_job,
      node: st.node ?? '',
      claude_signed_in: cl?.loggedIn ?? null,
      as_of: iso(asOf),
      next_check_after: iso(nextAt),
    },
  };
}

const REPORTING = ['starting', 'need_login', 'need_consent', 'running', 'online'];
const QUIET_MIN = 5;

/** one line per worker, then who each Claude account is running: the view a team spread over jobs and accounts needs */
export function describeWorkers(rows: WorkerRow[], truncated: boolean, asOf: number, cached: boolean, title: string): { text: string; structured: Record<string, unknown> } {
  if (rows.length === 0) {
    return { text: `No worker has been started under this grid account on the ${title} yet.`, structured: { workers: [], as_of: iso(asOf) } };
  }
  const lines = [`${rows.length} worker${rows.length === 1 ? '' : 's'} under this grid account on the ${title}:`];
  for (const w of rows) {
    const facts = [w.state === 'unreadable' ? 'its status file could not be read' : w.state];
    if (w.node) facts.push(`on ${w.node}`);
    if (w.job) facts.push(`job ${w.job}`);
    if (w.next_job) facts.push(`next job ${w.next_job} queued`);
    if (w.claude_signed_in === true) facts.push(`Claude account ${w.claude_account || 'not named'}${w.claude_plan ? ` (${w.claude_plan})` : ''}`);
    if (w.claude_signed_in === false) facts.push('not signed in to Claude');
    if (w.link) facts.push('has a Claude link');
    // a running job rewrites its status every 30 s; silence from one that says it is running means its job may be gone
    const quiet = REPORTING.includes(w.state) && Date.parse(w.updated_at) ? Math.floor((asOf - Date.parse(w.updated_at)) / 60_000) : 0;
    if (quiet >= QUIET_MIN) facts.push(`but it has not written its status for ${quiet} minutes, so its job may have ended without saying so (worker_status asks the scheduler)`);
    lines.push(`- "${w.name}": ${facts.join(', ')}.`);
  }
  const by = new Map<string, number>();
  for (const w of rows) {
    if (!w.claude_signed_in || ['stopped', 'error', 'unreadable', 'unknown'].includes(w.state)) continue;
    const a = w.claude_account || 'an account Claude Code did not name';
    by.set(a, (by.get(a) ?? 0) + 1);
  }
  if (by.size > 0) lines.push(`Running under: ${[...by].map(([a, n]) => `${a} (${n})`).join(', ')}.`);
  if (truncated) lines.push(`There are more than ${rows.length}; only the first ${rows.length} are shown.`);
  lines.push(`${cached ? 'As of' : 'Read from the grid at'} ${iso(asOf)}. worker_status, worker_stop, worker_log and open_in_claude take any of these names.`);
  return {
    text: lines.join('\n'),
    structured: { workers: rows, truncated, as_of: iso(asOf) },
  };
}

function describeSteps(name: string, steps: Step[], failed?: Step & { kind: 'failed' }): string {
  const out: string[] = [];
  for (const s of steps) {
    if (s.kind === 'setup') out.push(s.changed ? 'Your grid account was set up to use the lab\'s shared copy.' : 'Your grid account is ready.');
    if (s.kind === 'queued') out.push(s.kept ? `Worker "${name}" was already asked for (job ${s.job}); it keeps its place.` : `Worker "${name}" asked the grid for a computer (job ${s.job}).`);
  }
  if (failed) {
    const why: Record<string, string> = {
      setup: "Your grid account can't use the lab's copy yet. Ask your lab lead.",
      restricted: 'This workspace is marked restricted, so the worker will not start there.',
      refused: "The grid didn't take the request.",
    };
    out.push(why[failed.code] ?? "The grid didn't take the request.");
    if (failed.sentence) out.push(`(The grid said: ${failed.sentence})`);
  } else {
    out.push('Ask worker_status in a minute or two to see it come online.');
  }
  return out.join('\n');
}

// ---- the tools --------------------------------------------------------------------------------------------

/** the one tool that needs no grid, so the server offers it whatever the grid settings say */
export function accountTool(env: NodeJS.ProcessEnv = process.env): Tool {
  return {
    name: 'account_list',
    title: 'Your Claude accounts on this computer',
    description:
      "Lists the student's own Claude accounts on this computer as the account switcher (bee) keeps them: each one's label, whether it is on, " +
      'whether it rests and until when, and the last 5-hour and 7-day usage its status line saw. It reads bee\'s account list and one small usage file per account, ' +
      'and nothing else: no sign-in folder is opened, and it needs no grid sign-in and sends nothing to the grid. Beethoven never changes the list; ' +
      'the student does, with bee in their own terminal.',
    inputSchema: schema({}),
    annotations: { readOnlyHint: true, openWorldHint: false },
    call: async (args) => {
      only(args, []);
      const now = Date.now();
      const d = describeAccounts(readAccounts(registryDir(env), now), now);
      return result(d.text, d.structured, d.isError);
    },
  };
}

export function tools(grid: Grid): Tool[] {
  const title = grid.profile.sessionTitle;
  const nameArg = (args: Record<string, unknown>) => optString(args, 'name');
  const wrap = async <T>(o: Promise<Outcome<T>>, ok: (v: { ok: true } & T) => ToolResult): Promise<ToolResult> => {
    const r = await o;
    return r.ok ? ok(r) : failed(r);
  };

  return [
    {
      name: 'grid_sign_in',
      title: 'Sign in to the grid',
      description:
        `Opens a terminal window on this computer with ssh to the ${title}, where the student types their grid password and one-time code in ssh's own prompt. ` +
        'Beethoven never sees what is typed. The sign-in is then kept on this computer and every other tool uses it. ' +
        'The grid\'s host key is checked against the one pinned in this build first. If already signed in, it says so and opens nothing.',
      inputSchema: schema({}),
      // it opens a window and keeps a connection on this computer, so it is not read-only, but it removes nothing
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      call: async (args) => {
        only(args, []);
        return wrap(grid.signIn(), (r) => {
          if (r.already) return result(`Already signed in to the ${title}.`, { signed_in: true });
          if (!r.opened) {
            return result(
              `Beethoven couldn't open a terminal window on this computer. Run this file in a terminal yourself to sign in: ${r.command}`,
              { signed_in: false, launcher: r.command },
            );
          }
          if (r.signedIn === true) return result(`Signed in to the ${title}. The sign-in is kept for four hours after its last use.`, { signed_in: true });
          if (r.signedIn === null) return result(`A terminal window opened with ssh to the ${title}. Sign in there; keep it open while you use Beethoven.`, { signed_in: null });
          return result(
            `A terminal window opened with ssh to the ${title}. Type your grid password and one-time code there when ssh asks; Beethoven never sees them. When you're in, ask me to check (grid_check).`,
            { signed_in: false },
          );
        });
      },
    },
    {
      name: 'grid_sign_out',
      title: 'Sign out of the grid on this computer',
      description: 'Ends the sign-in Beethoven keeps on this computer (the ssh connection master). Nothing on the grid changes; the worker keeps running.',
      inputSchema: schema({}),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      call: async (args) => {
        only(args, []);
        return wrap(grid.signOut(), (r) => result(r.was ? 'Signed out of the grid on this computer. The worker is not affected.' : 'There was no kept sign-in to end.', { was_signed_in: r.was }));
      },
    },
    {
      name: 'grid_check',
      title: 'Check the grid connection',
      description: "Says whether this computer is signed in to the grid, which version of the lab's worker tool the grid runs, the grid account, and whether a Claude sign-in is on record there (from the worker's own files).",
      inputSchema: schema({}),
      annotations: { readOnlyHint: true, openWorldHint: true },
      call: async (args) => {
        only(args, []);
        // with no kept sign-in a request can still sign itself in with the student's own key; the version line decides
        const kept = await grid.signedIn();
        return wrap(grid.version(), (r) =>
          result(
            [
              kept === true ? 'Signed in to the grid.' : 'Connected to the grid (each request signs itself in with your own ssh key).',
              `Grid account: ${r.v.account}. The lab's worker tool: version ${r.v.framework}.`,
              r.v.claude === 'yes' ? 'Claude is signed in on the grid (the newest worker record says so).' : r.v.claude === 'no' ? 'Claude is not signed in on the grid.' : 'No worker has recorded a Claude sign-in yet.',
            ].join('\n'),
            { signed_in: true, account: r.v.account, framework: r.v.framework, claude_on_grid: r.v.claude },
          ),
        );
      },
    },
    {
      name: 'worker_status',
      title: "The worker's status",
      description: "Reads the worker's status from the grid: in line, starting, online with its Claude link, waiting for a Claude sign-in, renewing, stopped. Asks the grid at most once a minute; within that minute it gives the last answer and when it was read.",
      inputSchema: schema({ ...NAME_PROP }),
      annotations: { readOnlyHint: true, openWorldHint: true },
      call: async (args) => {
        only(args, ['name']);
        return wrap(grid.status(nameArg(args)), (r) => {
          const d = describeStatus(r.s, r.asOf, r.nextAt, r.cached, title, grid.profile.sharedInstall);
          return result(d.text, d.structured);
        });
      },
    },
    {
      name: 'worker_list',
      title: 'All your workers',
      description:
        "Lists every worker under the student's grid account, whichever computer, edition or teammate started it: each one's state, computer, job, " +
        'the Claude account it reported, and whether it has a Claude link. It reads each worker\'s own status file and asks the scheduler nothing, ' +
        'so nothing runs in the student\'s name unseen; the other worker tools take any of these names.',
      inputSchema: schema({}),
      annotations: { readOnlyHint: true, openWorldHint: true },
      call: async (args) => {
        only(args, []);
        return wrap(grid.workers(), (r) => {
          const d = describeWorkers(r.workers, r.truncated, r.asOf, r.cached, title);
          return result(d.text, d.structured);
        });
      },
    },
    {
      name: 'worker_start',
      title: 'Start the worker',
      description:
        "Asks the grid for the student's Claude Code worker through the lab's shared copy of the worker tool: one batch job, which then keeps itself running (renewing before its time ends) unless keep_running is false. " +
        'It never signs in to Claude: if the worker needs a Claude sign-in, the student does that in their own grid terminal. At most once a minute.',
      inputSchema: schema({
        ...NAME_PROP,
        permission_mode: { type: 'string', enum: [...PERMISSION_MODES], description: "How the worker's Claude Code asks before acting: default (asks before each command), acceptEdits, or plan. Leave it out for the site's default." },
        keep_running: { type: 'boolean', description: 'Keep the worker running by renewing itself before its time ends (the default), or let it end at its time.' },
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      call: async (args) => {
        only(args, ['name', 'permission_mode', 'keep_running']);
        const mode = optString(args, 'permission_mode');
        if (mode !== undefined && !PERMISSION_MODES.includes(mode as PermissionMode)) throw new ArgError('"permission_mode" is one of default, acceptEdits, plan.');
        const keep = optBool(args, 'keep_running') ?? true;
        return wrap(grid.start(nameArg(args), mode as PermissionMode | undefined, keep), (r) =>
          result(describeSteps(r.name, r.steps, r.failed), { name: r.name, steps: r.steps, failed: r.failed?.code ?? null }, Boolean(r.failed)),
        );
      },
    },
    {
      name: 'worker_stop',
      title: 'Stop the worker',
      description: "Stops the student's worker on the grid and ends its renewals: the worker's Claude session closes. Nothing is deleted; the workspace stays as it is. Ask the student before using it.",
      inputSchema: schema({ ...NAME_PROP }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
      call: async (args) => {
        only(args, ['name']);
        return wrap(grid.stop(nameArg(args)), (r) => result(`Stopped. ${r.line}`, { name: r.name, stopped: true }));
      },
    },
    {
      name: 'worker_log',
      title: "The worker's progress log",
      description: "The last lines of the worker's progress log on the grid: when it was asked for, got a computer, came online, renewed or stopped, each with its time (UTC).",
      inputSchema: schema({ ...NAME_PROP, lines: { type: 'integer', minimum: 1, maximum: 400, description: 'How many of the last lines (default 40).' } }),
      annotations: { readOnlyHint: true, openWorldHint: true },
      call: async (args) => {
        only(args, ['name', 'lines']);
        const n = optInt(args, 'lines', 1, 400) ?? 40;
        return wrap(grid.log(nameArg(args), n), (r) =>
          result(r.lines.length ? r.lines.join('\n') : 'The progress log is empty.', { name: r.name, lines: r.lines, as_of: iso(r.asOf) }),
        );
      },
    },
    {
      name: 'workspace_list',
      title: "List the worker's workspace",
      description: "Lists one folder of the worker's workspace on the grid (the folder the worker's Claude Code works in). path is relative to the workspace; leave it out for its top. Links are shown but never followed outside the workspace.",
      inputSchema: schema({ ...NAME_PROP, path: { type: 'string', description: 'A folder inside the workspace, like "src" or "results/run1".' } }),
      annotations: { readOnlyHint: true, openWorldHint: true },
      call: async (args) => {
        only(args, ['name', 'path']);
        const rel = optString(args, 'path') ?? '';
        return wrap(grid.list(nameArg(args), rel), (r) => {
          const rows = r.entries.map((e) => `${e.kind === 'dir' ? 'dir ' : e.kind === 'link' ? 'link' : e.kind === 'file' ? 'file' : 'other'}  ${e.kind === 'file' ? String(e.size ?? '?').padStart(10) : ''.padStart(10)}  ${e.name}${e.readable || e.kind !== 'file' ? '' : '  (not opened by Beethoven)'}`);
          const head = `Workspace of "${r.name}"${r.path ? `, folder ${r.path}` : ''}: ${r.entries.length} entries${r.truncated ? ' (the first 500)' : ''}.`;
          return result([head, ...rows].join('\n'), { name: r.name, path: r.path, entries: r.entries, truncated: r.truncated });
        });
      },
    },
    {
      name: 'workspace_read',
      title: "Read a file in the worker's workspace",
      description:
        `Reads one plain text file of the worker's workspace on the grid, up to max_bytes (default ${DEFAULT_READ}, at most ${MAX_READ}). ` +
        'Links, files outside the workspace and files named like credentials are refused; anything shaped like a credential in the text is replaced with [redacted].',
      inputSchema: schema(
        { ...NAME_PROP, path: { type: 'string', description: 'A file inside the workspace, like "CLAUDE.md" or "src/train.py".' }, max_bytes: { type: 'integer', minimum: 1, maximum: MAX_READ } },
        ['path'],
      ),
      annotations: { readOnlyHint: true, openWorldHint: true },
      call: async (args) => {
        only(args, ['name', 'path', 'max_bytes']);
        const rel = optString(args, 'path');
        if (!rel) throw new ArgError('Name a file with "path".');
        const max = optInt(args, 'max_bytes', 1, MAX_READ);
        return wrap(grid.read(nameArg(args), rel, max), (r) => {
          if (r.binary) return result(`${r.path} is not a text file (${r.size} bytes); Beethoven shows text only.`, { path: r.path, size: r.size, binary: true });
          const more = r.size > r.shown ? `\n[the first ${r.shown} of ${r.size} bytes]` : '';
          return result(`${r.text}${more}`, { path: r.path, size: r.size, shown: r.shown });
        });
      },
    },
    accountTool(),
    {
      name: 'open_in_claude',
      title: 'Open the worker in Claude',
      description: "Opens the worker's own Claude Code link (claude.ai/code) in the default browser, after checking it is exactly such a link. The worker must be online.",
      inputSchema: schema({ ...NAME_PROP }),
      annotations: { readOnlyHint: true, openWorldHint: true },
      call: async (args) => {
        only(args, ['name']);
        return wrap(grid.openInClaude(nameArg(args)), (r) =>
          result(r.opened ? `Opened ${r.link} in the browser.` : `Beethoven couldn't open the browser; the link is ${r.link}`, { link: r.link, opened: r.opened }),
        );
      },
    },
  ];
}

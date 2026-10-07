// The seam with the cluster side, as this edition reads it. The words of the wire come from the server
// repository's docs/V11_CONTRACT.md (status.json, connection.json, progress.log, HPCW-STEP) and
// docs/V12_CONTRACT.md (the gate's verbs); the link tests are beethoven-extension's contract.ts,
// copied, so a link the browser would refuse is refused here too. Change a format there and here
// together, against the same contract text. These are typed by hand until the server repository's
// `contract` export is pinned here and the tests read them against it (interface/README.md); on
// 2026-10-07 each was read against that repository's main (framework 17), and FAIL_CODES lacked two.

/** the gate's own test (gate_name_ok): never a leading "-", so a name can never read as an option */
export const WORKER_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/;
/** a site profile's name, as the gate's connect accepts it */
export const SITE_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;
/** an AccessID-shaped account name; it goes to ssh as -l, so nothing that could read as an option */
export const ACCOUNT_RE = /^[a-z_][a-z0-9_.-]{0,31}$/i;
export const PERMISSION_MODES = ['default', 'acceptEdits', 'plan'] as const;
export type PermissionMode = (typeof PERMISSION_MODES)[number];

export const ENVIRONMENT_URL = /https:\/\/claude\.(?:ai|com)\/code\?environment=env_[A-Za-z0-9_-]+/;
export const SESSION_URL = /https:\/\/claude\.(?:ai|com)\/code\/session_[A-Za-z0-9_-]+/;
export const CLAUDE_CODE_LINK = new RegExp(`${ENVIRONMENT_URL.source}|${SESSION_URL.source}`);

/** a link this edition may hand to the browser, exactly: an environment link or a session link */
export function isClaudeCodeLink(url: unknown): url is string {
  return typeof url === 'string' && new RegExp(`^(?:${CLAUDE_CODE_LINK.source})$`).test(url);
}

// ---- the gate (V12 "The gate") -------------------------------------------------------------------------
// What this edition asks of the grid is exactly these lines and nothing else: no free command, no
// `forget` (that verb removes the browser's key, which is not ours to remove), no `watch` (a 30-minute
// stream a tool call cannot hold), no `restrict`.

export type GateLine =
  | { verb: 'version' }
  | { verb: 'status'; name: string }
  | { verb: 'stop'; name: string }
  | { verb: 'read'; name: string; file: 'status.json' | 'connection.json' | 'progress.log' | 'node' }
  | { verb: 'connect'; name: string; site: string; mode: PermissionMode; chain: boolean };

/** the gate's SSH_ORIGINAL_COMMAND for a line; throws rather than place a value that fails its test */
export function gateCommand(g: GateLine): string {
  const name = (n: string) => {
    if (!WORKER_NAME_RE.test(n)) throw new Error('bad worker name');
    return n;
  };
  switch (g.verb) {
    case 'version':
      return 'version';
    case 'status':
      return `status ${name(g.name)}`;
    case 'stop':
      return `stop ${name(g.name)}`;
    case 'read':
      if (!['status.json', 'connection.json', 'progress.log', 'node'].includes(g.file)) throw new Error('bad file');
      return `read ${name(g.name)} ${g.file}`;
    case 'connect':
      if (!SITE_RE.test(g.site)) throw new Error('bad site');
      if (!PERMISSION_MODES.includes(g.mode)) throw new Error('bad mode');
      // "-": no installation id. The Remote Control answer is recorded by the browser edition or by
      // the student's own `hpcworker claude login`, never from here
      return `connect ${name(g.name)} ${g.site} - ${g.mode} ${g.chain ? 'chain' : 'no-chain'}`;
  }
}

/** the remote command line: the gate of the lab's shared copy, run over the student's own session */
export function gateRemoteLine(sharedInstall: string, g: GateLine): string {
  if (!/^\/[A-Za-z0-9._/-]+$/.test(sharedInstall) || sharedInstall.includes('/../')) throw new Error('bad shared install');
  // `env` rather than VAR=value: the account's login shell runs this line, and a csh would not read the
  // assignment. SSH_ORIGINAL_COMMAND also bars any Claude sign-in by itself (hpcw_signin_barred)
  return `env SSH_ORIGINAL_COMMAND='${gateCommand(g)}' bash '${sharedInstall.replace(/\/+$/, '')}/bin/hpcworker' gate`;
}

/** the gate's answers that are about the gate, not the verb: read by prefix (a ~/.bashrc may print first) */
export function gateRefusal(stdout: string): string | null {
  for (const line of stdout.split('\n')) {
    const m = /^HPCW-GATE (refused|limit \S+)\s*$/.exec(line.trim());
    if (m) return m[1]!;
    if (/^HPCW-KEY expired\s*$/.test(line.trim())) return 'expired';
  }
  return null;
}

export interface GateVersion {
  framework: string;
  account: string;
  claude: 'yes' | 'no' | 'unknown';
}

/** `HPCW-GATE ok <framework> <due|never|-> <account> claude=<yes|no|unknown>` */
export function parseGateVersion(stdout: string): GateVersion | null {
  for (const line of stdout.split('\n')) {
    const m = /^HPCW-GATE ok (\S+) (\S+) (\S+) claude=(yes|no|unknown)\s*$/.exec(line.trim());
    if (m) return { framework: m[1]!, account: m[3]!, claude: m[4] as GateVersion['claude'] };
  }
  return null;
}

// ---- worker status --json (V11 §6, §9, §10) ------------------------------------------------------------

export interface ClaudeLogin {
  loggedIn?: boolean;
  email?: string;
  subscriptionType?: string;
  checked_at?: string;
}

export interface StatusFile {
  state?: string;
  job?: string;
  node?: string;
  needs?: string;
  title?: string;
  submitted_at?: string;
  got_computer_at?: string;
  online_at?: string;
  ends_at?: string;
  updated_at?: string;
  renewal?: boolean;
  next_job?: string;
  environment_url?: string;
  session_url?: string;
  session_name?: string;
  claude_login?: ClaudeLogin;
  stop_reason?: string;
  restarts?: number;
  workspace?: string;
}

export interface StatusJson {
  v: 1;
  run: string;
  job: string;
  next_job: string;
  state_dir: string;
  status: StatusFile | null;
  connection: (StatusFile & { permission_mode?: string }) | null;
  scheduler: { state: string; reason: string; expected_start: string; node: string; checked_at: string } | null;
  line: string;
}

/** the one JSON line `status NAME` prints, found by its prefix */
export function parseStatusJson(stdout: string): StatusJson | null {
  for (const line of stdout.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('{"v":1')) continue;
    try {
      const j = JSON.parse(t) as StatusJson;
      if (j && j.v === 1 && typeof j.run === 'string') return j;
    } catch {
      // a line that only looks like ours
    }
  }
  return null;
}

/** the worker's link, either form, from the files the job wrote: the environment link first (a new session can start there) */
export function linkOf(s: StatusJson): string | null {
  for (const f of [s.status, s.connection]) {
    if (!f) continue;
    if (isClaudeCodeLink(f.environment_url)) return f.environment_url;
  }
  for (const f of [s.status, s.connection]) {
    if (!f) continue;
    if (isClaudeCodeLink(f.session_url)) return f.session_url;
  }
  return null;
}

// ---- HPCW-STEP (V11 §5.3) ------------------------------------------------------------------------------

export type Step =
  | { kind: 'setup'; changed: boolean }
  | { kind: 'consent' }
  | { kind: 'queued'; job: string; kept: boolean; runDir: string }
  | { kind: 'signin' }
  | { kind: 'signed-in'; email: string; plan: string }
  | { kind: 'done' }
  | { kind: 'failed'; code: FailCode; sentence: string };

/** every code connect prints after "HPCW-STEP failed" (hpcworker's step_fail and die, framework 17); any other word reads as `other` */
export const FAIL_CODES = [
  'usage', 'setup', 'restricted', 'refused', 'signin-node', 'signin-code', 'signin-timeout', 'signin-billed', 'signin-method', 'signin', 'other',
] as const;
export type FailCode = (typeof FAIL_CODES)[number];
const isFailCode = (w: string): w is FailCode => (FAIL_CODES as readonly string[]).includes(w);

export function parseStepLine(raw: string): Step | null {
  const line = raw.replace(/\r$/, '');
  let m: RegExpExecArray | null;
  if ((m = /^HPCW-STEP setup (ready|changed)$/.exec(line))) return { kind: 'setup', changed: m[1] === 'changed' };
  if (line === 'HPCW-STEP consent') return { kind: 'consent' };
  if ((m = /^HPCW-STEP queued (\d+) (new|kept)(?: (.+))?$/.exec(line))) return { kind: 'queued', job: m[1]!, kept: m[2] === 'kept', runDir: m[3] ?? '' };
  if (line === 'HPCW-STEP signin') return { kind: 'signin' };
  if ((m = /^HPCW-STEP signed-in (\S+) (\S+)$/.exec(line))) return { kind: 'signed-in', email: m[1]!, plan: m[2]! };
  if (line === 'HPCW-STEP done') return { kind: 'done' };
  if ((m = /^HPCW-STEP failed (\S+)(?: (.*))?$/.exec(line))) {
    return { kind: 'failed', code: isFailCode(m[1]!) ? m[1]! : 'other', sentence: m[2] ?? '' };
  }
  return null;
}

/** progress.log's lines (V11 §11): `<YYYY-MM-DDTHH:MM:SSZ> <sentence>`; anything else (a ~/.bashrc's words) is dropped */
export function progressLines(text: string): string[] {
  return text.split('\n').filter((l) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z \S/.test(l));
}

/** `worker NAME: stopped (...)` (V11 §7.1) */
export function stoppedLine(stdout: string): string | null {
  for (const line of stdout.split('\n')) if (/^worker \S+: stopped \(/.test(line)) return line.trim();
  return null;
}

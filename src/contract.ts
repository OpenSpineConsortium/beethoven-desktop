// The seam with the cluster side, as this edition reads it. The words of the wire are the server
// repository's `contract` export, pinned in contract/ (cli.json, lines.json, the schemas, rules.json and
// the vectors its real writer produced), and its `contract-text` export in contract-text/ says why
// (V11_CONTRACT.md: status.json, connection.json, progress.log, HPCW-STEP; V12_CONTRACT.md: the gate).
// The link tests are beethoven-extension's contract.ts, copied, so a link the browser would refuse is
// refused here too. Everything below is typed by hand, because the server ships without the pinned
// folders; test/contract.test.ts holds each pattern, word and number equal to the pinned export, and
// runs every vector this edition reads through the parser that reads it. A new pull that moves one of
// them fails that test until this file moves with it.

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

/** what a line is read as (lines.json): terminal codes stripped, carriage returns dropped, any glued keepalive removed, trimmed */
export const KEEPALIVE = 'HPCW-LOGIN: still waiting';
// ECMA-48: a control sequence (CSI), an operating system command (OSC), or one escape and a byte
const TERMINAL_CODE = /\x1b(?:\[[0-?]*[ -\/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)|[@-Z\\-_])/g;
export function cleanLine(raw: string): string {
  return raw.replace(TERMINAL_CODE, '').replace(/\r/g, '').split(KEEPALIVE).join('').trim();
}

// ---- the gate (V12 "The gate") -------------------------------------------------------------------------
// What this edition asks of the grid is exactly these lines and nothing else: no free command, no
// `forget` (that verb removes the browser's key, which is not ours to remove), no `watch` (a 30-minute
// stream a tool call cannot hold), no `restrict`.

/** the files the gate's `read` takes (cli.json values.gate_file) */
export const GATE_FILES = ['status.json', 'connection.json', 'progress.log', 'node'] as const;
export type GateFile = (typeof GATE_FILES)[number];

export type GateLine =
  | { verb: 'version' }
  | { verb: 'status'; name: string }
  | { verb: 'stop'; name: string }
  | { verb: 'read'; name: string; file: GateFile }
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
      if (!(GATE_FILES as readonly string[]).includes(g.file)) throw new Error('bad file');
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

/** lines.json family "gate", as the gate prints them */
export const GATE_LINES = {
  ok: /^HPCW-GATE ok (\S+) ([0-9]{4}-[0-9]{2}-[0-9]{2}|never|-) (\S+) claude=(yes|no|unknown)$/,
  refused: /^HPCW-GATE refused$/,
  limit: /^HPCW-GATE limit (names|hourly|watch|busy)$/,
  missing: /^HPCW-GATE missing$/,
  'not-plain': /^HPCW-GATE not-plain$/,
  'too-large': /^HPCW-GATE too-large$/,
} as const;
/** lines.json family "key": the one line of it the gate may print before a verb here */
export const KEY_EXPIRED = /^HPCW-KEY expired$/;
/** the exit status each of `read`'s failures comes with, its line on standard error */
export const GATE_READ_EXIT = { missing: 1, 'not-plain': 3, 'too-large': 3 } as const;
export type GateReadFailure = keyof typeof GATE_READ_EXIT;

/** the gate's answers that are about the gate, not the verb: read by prefix (a ~/.bashrc may print first) */
export function gateRefusal(stdout: string): string | null {
  for (const raw of stdout.split('\n')) {
    const line = cleanLine(raw);
    let m: RegExpExecArray | null;
    if (GATE_LINES.refused.test(line)) return 'refused';
    if ((m = GATE_LINES.limit.exec(line))) return `limit ${m[1]!}`;
    if (KEY_EXPIRED.test(line)) return 'expired';
  }
  return null;
}

/** why the gate's `read` gave no file, from its line on standard error; null when it gave none of them */
export function gateReadFailure(stderr: string): GateReadFailure | null {
  for (const raw of stderr.split('\n')) {
    const line = cleanLine(raw);
    for (const k of Object.keys(GATE_READ_EXIT) as GateReadFailure[]) if (GATE_LINES[k].test(line)) return k;
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
  for (const raw of stdout.split('\n')) {
    const m = GATE_LINES.ok.exec(cleanLine(raw));
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

/** connection.json (V11 §10): what this edition reads of it */
export interface ConnectionFile {
  session_name?: string;
  session_url?: string;
  environment_url?: string;
  node?: string;
  job?: string;
  online_at?: string;
  permission_mode?: string;
  title?: string;
}

export interface StatusJson {
  v: 1;
  run: string;
  job: string;
  next_job: string;
  state_dir: string;
  status: StatusFile | null;
  connection: ConnectionFile | null;
  scheduler: { state: string; reason: string; expected_start: string; node: string; checked_at: string } | null;
  line: string;
}

/** the one JSON line `status NAME` prints, found by its prefix */
export function parseStatusJson(stdout: string): StatusJson | null {
  for (const line of stdout.split('\n')) {
    const t = cleanLine(line);
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

/** lines.json family "step", as connect prints them */
export const STEP_LINES = {
  setup: /^HPCW-STEP setup (ready|changed)$/,
  consent: /^HPCW-STEP consent$/,
  queued: /^HPCW-STEP queued ([0-9]+) (new|kept)(?: (.+))?$/,
  signin: /^HPCW-STEP signin$/,
  'signed-in': /^HPCW-STEP signed-in (\S+) (\S+)$/,
  done: /^HPCW-STEP done$/,
  failed: /^HPCW-STEP failed ([a-z-]+)(?: (.*))?$/,
} as const;

export function parseStepLine(raw: string): Step | null {
  const line = cleanLine(raw);
  let m: RegExpExecArray | null;
  if ((m = STEP_LINES.setup.exec(line))) return { kind: 'setup', changed: m[1] === 'changed' };
  if (STEP_LINES.consent.test(line)) return { kind: 'consent' };
  if ((m = STEP_LINES.queued.exec(line))) return { kind: 'queued', job: m[1]!, kept: m[2] === 'kept', runDir: m[3] ?? '' };
  if (STEP_LINES.signin.test(line)) return { kind: 'signin' };
  if ((m = STEP_LINES['signed-in'].exec(line))) return { kind: 'signed-in', email: m[1]!, plan: m[2]! };
  if (STEP_LINES.done.test(line)) return { kind: 'done' };
  if ((m = STEP_LINES.failed.exec(line))) {
    return { kind: 'failed', code: isFailCode(m[1]!) ? m[1]! : 'other', sentence: m[2] ?? '' };
  }
  return null;
}

/** lines.json family "progress": `<YYYY-MM-DDTHH:MM:SSZ> <sentence>` (V11 §11) */
export const PROGRESS_LINE = /^([0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z) (.+)$/;

/** progress.log's lines; anything else (a ~/.bashrc's words) is dropped */
export function progressLines(text: string): string[] {
  return text.split('\n').map(cleanLine).filter((l) => PROGRESS_LINE.test(l));
}

/**
 * `worker NAME: stopped (...)` (V11 §7.1, the gate's `stop` in V12). lines.json does not carry this line;
 * V11 §7.1 gives the test of success, exit 0 and this pattern
 */
export const STOPPED_LINE = /^worker \S+: stopped \(/;

export function stoppedLine(stdout: string): string | null {
  for (const raw of stdout.split('\n')) {
    const line = cleanLine(raw);
    if (STOPPED_LINE.test(line)) return line;
  }
  return null;
}

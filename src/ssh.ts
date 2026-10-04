// The student's own OpenSSH, spawned; never an ssh library of ours. The student signs in once, in a
// terminal of their own, in ssh's own prompt (grid password and one-time code); that ssh becomes a
// connection master (ControlMaster) and every tool call afterwards is a client of it, so no password,
// code or key ever passes through this process. Where the ssh cannot share a sign-in (Windows' own
// OpenSSH has no ControlMaster), a call signs in by itself only with the student's own key or agent
// (BatchMode): it can never stop at a prompt, and it never asks for a password.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { ACCOUNT_RE } from './contract.js';
import type { Config } from './config.js';
import type { SiteProfile } from './profile.js';

export const DIR_NAME = '.beethoven-desktop';
/** how long the kept sign-in lives after its last use; each tool call starts it over */
export const PERSIST = '4h';

export interface Route {
  kind: 'native' | 'wsl';
  platform: NodeJS.Platform;
  /** the program and its leading words, for ssh and for ssh-keyscan */
  ssh: string[];
  keyscan: string[];
  /** this ssh can keep one sign-in for every call */
  mux: boolean;
  /** our folder as this process writes it */
  localDir: string;
  /** the control socket's path as the ssh program reads it (%C: ssh's hash of host, port and user) */
  controlPath: string;
  /** the pinned known_hosts file as the ssh program reads it, and as this process writes it */
  knownHosts: string;
  localKnownHosts: string;
}

/** C:\Users\x\.beethoven-desktop\known_hosts -> /mnt/c/Users/x/.beethoven-desktop/known_hosts (WSL's default mount) */
export function wslPath(win: string): string {
  const m = /^([A-Za-z]):[\\/](.*)$/.exec(win);
  return m ? `/mnt/${m[1]!.toLowerCase()}/${m[2]!.replace(/\\/g, '/')}` : win.replace(/\\/g, '/');
}

export function routeFor(cfg: Pick<Config, 'useWsl' | 'sshPath'>, platform: NodeJS.Platform = process.platform, home: string = homedir(), env: NodeJS.ProcessEnv = process.env): Route {
  const localDir = join(home, DIR_NAME);
  const localKnownHosts = join(localDir, 'known_hosts');
  if (platform === 'win32' && cfg.useWsl) {
    return {
      kind: 'wsl',
      platform,
      ssh: ['wsl.exe', '-e', 'ssh'],
      keyscan: ['wsl.exe', '-e', 'ssh-keyscan'],
      mux: true,
      localDir,
      // a Unix socket cannot live on the Windows drive, so the socket is in WSL's own home
      controlPath: `~/${DIR_NAME}/cm-%C`,
      knownHosts: wslPath(localKnownHosts),
      localKnownHosts,
    };
  }
  let ssh = cfg.sshPath;
  if (!ssh) {
    const sys = join(env.SystemRoot ?? 'C:\\Windows', 'System32', 'OpenSSH', 'ssh.exe');
    ssh = platform === 'win32' ? (existsSync(sys) ? sys : 'ssh.exe') : 'ssh';
  }
  const scanName = platform === 'win32' ? 'ssh-keyscan.exe' : 'ssh-keyscan';
  const keyscan = /[\\/]/.test(ssh) ? join(dirname(ssh), scanName) : scanName;
  return {
    kind: 'native',
    platform,
    ssh: [ssh],
    keyscan: [keyscan],
    mux: platform !== 'win32',
    localDir,
    controlPath: join(localDir, 'cm-%C'),
    knownHosts: localKnownHosts,
    localKnownHosts,
  };
}

export interface Target {
  host: string;
  port: number;
  account: string;
}

export function targetOf(p: SiteProfile, account: string): Target {
  if (!ACCOUNT_RE.test(account)) throw new Error('bad account');
  return { host: p.sshHost, port: p.sshPort, account };
}

/** what every ssh of ours says, whatever the student's own ssh config says: the pinned key only, no forwarding */
function common(r: Route, t: Target): string[] {
  return [
    '-o', `UserKnownHostsFile=${r.knownHosts}`,
    '-o', 'StrictHostKeyChecking=yes',
    '-o', 'CheckHostIP=no',
    '-o', 'UpdateHostKeys=no',
    '-o', 'ForwardAgent=no',
    '-o', 'ForwardX11=no',
    '-o', 'ClearAllForwardings=yes',
    '-o', 'PermitLocalCommand=no',
    '-p', String(t.port),
    '-l', t.account,
  ];
}

/** the student's sign-in, run in their own terminal: an interactive ssh that becomes the connection master */
export function signInArgv(r: Route, t: Target): string[] {
  const mux = r.mux ? ['-o', 'ControlMaster=auto', '-o', `ControlPath=${r.controlPath}`, '-o', `ControlPersist=${PERSIST}`] : [];
  return [...r.ssh, ...common(r, t), ...mux, '-o', 'ServerAliveInterval=60', t.host];
}

/** one tool call: never a prompt (BatchMode), never a terminal (-T), the kept sign-in when there is one */
export function callArgv(r: Route, t: Target, remote: string): string[] {
  const mux = r.mux ? ['-o', 'ControlMaster=no', '-o', `ControlPath=${r.controlPath}`] : [];
  return [
    ...r.ssh, ...common(r, t), ...mux,
    '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=20', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=2',
    '-o', 'LogLevel=ERROR', '-T', t.host, remote,
  ];
}

/** the sftp subsystem over the same session: sshd's own sftp-server, no shell command of ours */
export function sftpArgv(r: Route, t: Target): string[] {
  const mux = r.mux ? ['-o', 'ControlMaster=no', '-o', `ControlPath=${r.controlPath}`] : [];
  return [
    ...r.ssh, ...common(r, t), ...mux,
    '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=20', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=2',
    '-o', 'LogLevel=ERROR', '-T', '-s', t.host, 'sftp',
  ];
}

/** ssh -O check|exit: asks the local master only; nothing reaches the grid */
export function controlArgv(r: Route, t: Target, op: 'check' | 'exit'): string[] {
  return [...r.ssh, '-o', `ControlPath=${r.controlPath}`, '-O', op, '-p', String(t.port), '-l', t.account, t.host];
}

export function keyscanArgv(r: Route, t: Target): string[] {
  return [...r.keyscan, '-T', '10', '-p', String(t.port), t.host];
}

// ---- running ---------------------------------------------------------------------------------------

/** nothing of a credential's name reaches a child, though ssh would not send it on anyway (SendEnv) */
const DROP_ENV = /^(?:ANTHROPIC_|CLAUDE_CODE_|CLAUDECODE$|AI_AGENT$)|TOKEN|SECRET|PASSWORD|PASSWD|API_?KEY/i;

export function childEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(env)) if (v !== undefined && !DROP_ENV.test(k)) out[k] = v;
  return out;
}

export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  /** the program could not be started at all (not installed) */
  missing: boolean;
}

export function run(argv: string[], opts: { timeoutMs?: number; maxBytes?: number; input?: string } = {}): Promise<RunResult> {
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const maxBytes = opts.maxBytes ?? 2 * 1024 * 1024;
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(argv[0]!, argv.slice(1), { shell: false, windowsHide: true, env: childEnv(), stdio: ['pipe', 'pipe', 'pipe'] });
    } catch {
      resolve({ code: null, stdout: '', stderr: '', timedOut: false, missing: true });
      return;
    }
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let n = 0;
    let timedOut = false;
    let missing = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, timeoutMs);
    child.stdout.on('data', (b: Buffer) => {
      n += b.length;
      if (n <= maxBytes) out.push(b);
      else child.kill('SIGTERM');
    });
    child.stderr.on('data', (b: Buffer) => {
      if (err.reduce((a, x) => a + x.length, 0) < 64 * 1024) err.push(b);
    });
    child.on('error', (e: NodeJS.ErrnoException) => {
      if (e.code === 'ENOENT') missing = true;
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout: Buffer.concat(out).toString('utf8'), stderr: Buffer.concat(err).toString('utf8'), timedOut, missing });
    });
    child.stdin.on('error', () => {});
    child.stdin.end(opts.input ?? '');
  });
}

export type SshFailure = 'not-installed' | 'not-signed-in' | 'hostkey' | 'unreachable' | 'timeout' | 'ssh';

/** why an ssh ended with 255 (its own failure, not the remote command's), from its own words */
export function classify(r: RunResult): SshFailure | null {
  if (r.missing) return 'not-installed';
  if (r.timedOut) return 'timeout';
  if (r.code !== 255) return null;
  const e = r.stderr;
  if (/Host key verification failed|REMOTE HOST IDENTIFICATION HAS CHANGED|No (?:RSA|ED25519|ECDSA)? ?host key is known/i.test(e)) return 'hostkey';
  if (/Permission denied|Too many authentication failures|No more authentication methods/i.test(e)) return 'not-signed-in';
  if (/Could not resolve hostname|Name or service not known|nodename nor servname|timed out|Connection refused|No route to host|Network is unreachable|Connection closed by|Connection reset/i.test(e)) return 'unreachable';
  return 'ssh';
}

/** one ssh at a time: each call is a few processes on the login node, and they never pile up */
export class Serial {
  private tail: Promise<unknown> = Promise.resolve();
  run<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.tail.then(fn, fn);
    this.tail = next.catch(() => {});
    return next;
  }
}

// ---- the host key, pinned ------------------------------------------------------------------------------
// The site profile carries the grid's host key fingerprint. Before the first sign-in, ssh-keyscan asks the
// grid for its keys (no account, no sign-in), only a key whose SHA256 fingerprint is the profile's is
// written to our own known_hosts, and every ssh of ours uses that file alone with StrictHostKeyChecking:
// any other key stops the connection before anything about the student is sent. No trust on first use.

export function fingerprintOf(b64: string): string {
  const blob = Buffer.from(b64, 'base64');
  return 'SHA256:' + createHash('sha256').update(blob).digest('base64').replace(/=+$/, '');
}

export function hostPattern(t: Pick<Target, 'host' | 'port'>): string {
  return t.port === 22 ? t.host : `[${t.host}]:${t.port}`;
}

const KEY_TYPE_RE = /^(?:ssh-rsa|ssh-ed25519|ecdsa-sha2-nistp(?:256|384|521)|rsa-sha2-(?:256|512))$/;

/** the known_hosts lines of a scan (or of our own file) whose key is the pinned one, rewritten for our host */
export function pinnedLines(text: string, pin: string, t: Pick<Target, 'host' | 'port'>): { lines: string[]; seen: string[] } {
  const lines: string[] = [];
  const seen: string[] = [];
  for (const raw of text.split('\n')) {
    const l = raw.trim();
    if (!l || l.startsWith('#')) continue;
    const w = l.split(/\s+/);
    if (w.length < 3 || !KEY_TYPE_RE.test(w[1]!) || !/^[A-Za-z0-9+/]+={0,2}$/.test(w[2]!)) continue;
    const fp = fingerprintOf(w[2]!);
    seen.push(`${w[1]} ${fp}`);
    if (fp === pin) lines.push(`${hostPattern(t)} ${w[1]} ${w[2]}`);
  }
  return { lines, seen };
}

export type PinResult = { ok: true; fresh: boolean } | { ok: false; why: 'mismatch' | 'unreachable' | 'not-installed'; seen: string[] };

export function ensureDir(r: Route): void {
  mkdirSync(r.localDir, { recursive: true, mode: 0o700 });
}

export async function ensurePinned(r: Route, t: Target, pin: string, runner: typeof run = run): Promise<PinResult> {
  ensureDir(r);
  try {
    const have = pinnedLines(readFileSync(r.localKnownHosts, 'utf8'), pin, t);
    // a file of ours holds nothing but pinned lines; one that holds anything else (an older pin) is redone
    if (have.lines.length > 0 && have.lines.length === have.seen.length) return { ok: true, fresh: false };
  } catch {
    // none yet
  }
  const res = await runner(keyscanArgv(r, t), { timeoutMs: 30_000 });
  if (res.missing) return { ok: false, why: 'not-installed', seen: [] };
  const got = pinnedLines(res.stdout, pin, t);
  if (got.lines.length === 0) return { ok: false, why: got.seen.length ? 'mismatch' : 'unreachable', seen: got.seen };
  const part = `${r.localKnownHosts}.part`;
  writeFileSync(part, got.lines.join('\n') + '\n', { mode: 0o600 });
  renameSync(part, r.localKnownHosts);
  return { ok: true, fresh: true };
}

/** inside WSL, our folder for the control socket must exist in WSL's own home, owner-only */
export async function ensureWslDir(r: Route, runner: typeof run = run): Promise<boolean> {
  if (r.kind !== 'wsl') return true;
  const res = await runner(['wsl.exe', '-e', 'sh', '-c', `mkdir -p "$HOME/${DIR_NAME}" && chmod 700 "$HOME/${DIR_NAME}"`], { timeoutMs: 30_000 });
  return res.code === 0;
}


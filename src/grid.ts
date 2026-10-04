// What a tool may ask of the grid, and how often. Each verb is one ssh over the student's kept sign-in,
// one at a time (Serial), behind this edition's own floors: worker status at most once a minute per
// worker (the gate's --poll-floor 60 is a second floor behind it), starts and stops at most once a
// minute, the log and the workspace at most once in five seconds per thing read; within a floor the last
// answer is given again with the time it was read. Nothing here deletes anything, anywhere.
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import {
  gateRefusal, gateRemoteLine, linkOf, parseGateVersion, parseStatusJson, parseStepLine, progressLines, stoppedLine,
  WORKER_NAME_RE, type GateLine, type GateVersion, type PermissionMode, type StatusJson, type Step,
} from './contract.js';
import type { Config } from './config.js';
import { stateDirFor, type SiteProfile } from './profile.js';
import { redact } from './redact.js';
import { Sftp, SftpError } from './sftp.js';
import {
  callArgv, childEnv, classify, controlArgv, ensurePinned, ensureWslDir, routeFor, run, Serial, sftpArgv, signInArgv,
  targetOf, type Route, type RunResult, type Target,
} from './ssh.js';
import { launch, openerArgv, signInLines, terminalArgv, writeLauncher } from './terminal.js';
import { listWorkers, type WorkerRow } from './runs.js';
import { listDir, openWorkspace, readText, WorkspaceError, type FileText, type Listing } from './workspace.js';

export const STATUS_FLOOR_MS = 60_000;
export const PRESS_FLOOR_MS = 60_000;
export const READ_FLOOR_MS = 5_000;
/** how long grid_sign_in waits for the student to finish signing in before it answers anyway */
export const SIGN_IN_WAIT_MS = 40_000;

export type Outcome<T> = ({ ok: true } & T) | { ok: false; message: string };

export interface Deps {
  run: typeof run;
  launch: typeof launch;
  spawnSftp: (argv: string[]) => ChildProcessWithoutNullStreams;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  platform: NodeJS.Platform;
  home?: string;
  env: NodeJS.ProcessEnv;
}

export const realDeps: Deps = {
  run,
  launch,
  spawnSftp: (argv) => spawn(argv[0]!, argv.slice(1), { shell: false, windowsHide: true, env: childEnv(), stdio: ['pipe', 'pipe', 'pipe'] }),
  now: () => Date.now(),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  platform: process.platform,
  env: process.env,
};

interface Cached<T> {
  at: number;
  value: T;
}

export class Grid {
  readonly route: Route;
  private readonly serial = new Serial();
  private readonly statusCache = new Map<string, Cached<StatusJson>>();
  private readonly pressAt = new Map<string, number>();
  private readonly reads = new Map<string, Cached<unknown>>();

  constructor(readonly cfg: Config, readonly profile: SiteProfile, private readonly d: Deps = realDeps) {
    this.route = routeFor(cfg, d.platform, d.home, d.env);
  }

  // ---- the student's sign-in --------------------------------------------------------------------------

  private target(): Outcome<{ t: Target }> {
    if (!this.cfg.account) {
      return { ok: false, message: "Beethoven doesn't know your grid account name yet. Set it in Beethoven's settings (Claude Desktop: Settings, Extensions, Beethoven), then ask again." };
    }
    return { ok: true, t: targetOf(this.profile, this.cfg.account) };
  }

  /** true when a kept sign-in is up; null where this ssh cannot keep one */
  async signedIn(): Promise<boolean | null> {
    if (!this.route.mux) return null;
    const t = this.target();
    if (!t.ok) return false;
    const r = await this.d.run(controlArgv(this.route, t.t, 'check'), { timeoutMs: 15_000 });
    return r.code === 0;
  }

  async signIn(): Promise<Outcome<{ already: boolean; opened: boolean; signedIn: boolean | null; command?: string }>> {
    const t = this.target();
    if (!t.ok) return t;
    if (!(await ensureWslDir(this.route, this.d.run))) return { ok: false, message: "WSL didn't answer. Check that a Linux distribution is installed in WSL, or turn off \"Use WSL\" in Beethoven's settings." };
    const pin = await ensurePinned(this.route, t.t, this.profile.sshHostKey, this.d.run);
    if (!pin.ok) return { ok: false, message: this.pinMessage(pin.why) };
    if ((await this.signedIn()) === true) return { ok: true, already: true, opened: false, signedIn: true };
    const argv = signInArgv(this.route, t.t);
    const lines = signInLines(this.profile.sessionTitle, this.route.mux);
    const launcher = writeLauncher(this.route.localDir, this.d.platform, argv, lines);
    const term = terminalArgv(this.d.platform, launcher, this.d.env);
    const opened = term ? await this.d.launch(term) : false;
    if (!opened) return { ok: true, already: false, opened: false, signedIn: false, command: launcher };
    if (!this.route.mux) return { ok: true, already: false, opened: true, signedIn: null };
    // the student types in the window just opened; wait a little for the master, then answer either way
    const until = this.d.now() + SIGN_IN_WAIT_MS;
    while (this.d.now() < until) {
      await this.d.sleep(2_000);
      if ((await this.signedIn()) === true) return { ok: true, already: false, opened: true, signedIn: true };
    }
    return { ok: true, already: false, opened: true, signedIn: false };
  }

  /** ends the kept sign-in on this computer (ssh -O exit); the grid sees an ordinary disconnect */
  async signOut(): Promise<Outcome<{ was: boolean }>> {
    const t = this.target();
    if (!t.ok) return t;
    if (!this.route.mux) return { ok: true, was: false };
    const r = await this.d.run(controlArgv(this.route, t.t, 'exit'), { timeoutMs: 15_000 });
    return { ok: true, was: r.code === 0 };
  }

  private pinMessage(why: 'mismatch' | 'unreachable' | 'not-installed'): string {
    if (why === 'mismatch') return `The grid answered with a key Beethoven doesn't know (the ${this.profile.sessionTitle}'s key is pinned in this build), so Beethoven stopped before sending anything about you. Tell your lab lead.`;
    if (why === 'not-installed') return this.missingMessage();
    return this.unreachableMessage();
  }

  private unreachableMessage(): string {
    return this.profile.vpnRequired && this.profile.vpnApp
      ? `The grid can't be reached from this computer. Connect to your university's VPN (${this.profile.vpnApp}) and try again.`
      : "The grid can't be reached from this computer right now. Try again in a minute.";
  }

  private missingMessage(): string {
    if (this.route.kind === 'wsl') return "WSL's ssh wasn't found. In WSL, install the OpenSSH client (on Ubuntu: sudo apt install openssh-client).";
    if (this.d.platform === 'win32') return "This computer's OpenSSH Client wasn't found. Turn it on in Windows Settings (System, Optional features), or turn on \"Use WSL\" in Beethoven's settings.";
    return "This computer's ssh wasn't found.";
  }

  // ---- one gate line --------------------------------------------------------------------------------

  // With no kept sign-in, ssh finds no control socket and signs in by itself, with the student's own key
  // or agent only (BatchMode): a password account then gets "Permission denied" at once, never a prompt.
  private async gate(g: GateLine, timeoutMs = 90_000): Promise<Outcome<{ out: string; res: RunResult }>> {
    const t = this.target();
    if (!t.ok) return t;
    return this.serial.run(async () => {
      const pin = await ensurePinned(this.route, t.t, this.profile.sshHostKey, this.d.run);
      if (!pin.ok) return { ok: false as const, message: this.pinMessage(pin.why) };
      const res = await this.d.run(callArgv(this.route, t.t, gateRemoteLine(this.profile.sharedInstall, g)), { timeoutMs });
      const failure = classify(res);
      if (failure) return { ok: false as const, message: this.sshMessage(failure, res) };
      const refusal = gateRefusal(res.stdout);
      if (refusal) return { ok: false as const, message: this.refusalMessage(refusal) };
      if ((res.code === 126 || res.code === 127) && /hpcworker/.test(res.stderr)) {
        return { ok: false as const, message: "Your grid account can't use the lab's shared copy of the worker tool. Ask your lab lead to add you to the approved list." };
      }
      return { ok: true as const, out: res.stdout, res };
    });
  }

  private sshMessage(f: ReturnType<typeof classify>, res: RunResult): string {
    switch (f) {
      case 'not-installed':
        return this.missingMessage();
      case 'not-signed-in':
        return this.route.mux
          ? "You're not signed in to the grid. Use grid_sign_in: a terminal opens, and you sign in there with your grid password and code."
          : "Windows' own ssh can't keep a sign-in between requests, so Beethoven needs your own ssh key for the grid here, or \"Use WSL\" turned on in its settings.";
      case 'hostkey':
        return this.pinMessage('mismatch');
      case 'unreachable':
        return this.unreachableMessage();
      case 'timeout':
        return "The grid didn't answer in time. Try again in a minute.";
      default: {
        const first = res.stderr.split('\n').map((l) => l.trim()).find(Boolean) ?? '';
        return `ssh stopped${first ? `: ${redact(first)}` : '.'}`;
      }
    }
  }

  private refusalMessage(r: string): string {
    if (r === 'limit names') return 'This account has used three worker names in the last week, the most the grid allows here. Use one of those names.';
    if (r === 'limit hourly') return 'This account has started workers twelve times in the last hour, the most the grid allows. Try again later.';
    if (r === 'limit watch' || r === 'limit busy') return 'The grid is busy with this account right now. Try again in a minute.';
    if (r === 'expired') return 'The grid removed an expired browser key of this account and stopped this one request. Ask again.';
    return "The grid's copy of the worker tool refused that request; it may be older than this edition. Tell your lab lead.";
  }

  // ---- the verbs --------------------------------------------------------------------------------------

  async version(): Promise<Outcome<{ v: GateVersion }>> {
    const r = await this.gate({ verb: 'version' }, 60_000);
    if (!r.ok) return r;
    const v = parseGateVersion(r.out);
    if (!v) return { ok: false, message: "The grid's copy of the worker tool didn't answer as expected; it may be older than this edition." };
    return { ok: true, v };
  }

  private name(n: string | undefined): Outcome<{ name: string }> {
    const name = n || this.cfg.worker;
    if (!WORKER_NAME_RE.test(name)) return { ok: false, message: 'A worker name uses letters, digits, - and _ only, at most 32, starting with a letter or digit.' };
    return { ok: true, name };
  }

  async status(n?: string): Promise<Outcome<{ s: StatusJson; asOf: number; cached: boolean; nextAt: number }>> {
    const nm = this.name(n);
    if (!nm.ok) return nm;
    const c = this.statusCache.get(nm.name);
    const now = this.d.now();
    if (c && now - c.at < STATUS_FLOOR_MS) return { ok: true, s: c.value, asOf: c.at, cached: true, nextAt: c.at + STATUS_FLOOR_MS };
    const r = await this.gate({ verb: 'status', name: nm.name }, 60_000);
    if (!r.ok) return r;
    const s = parseStatusJson(r.out);
    if (!s) {
      if (/no worker named/.test(r.res.stderr)) return { ok: false, message: `There is no worker named "${nm.name}" yet. Start one with worker_start.` };
      return { ok: false, message: "The grid's answer about the worker couldn't be read." };
    }
    const at = this.d.now();
    this.statusCache.set(nm.name, { at, value: s });
    return { ok: true, s, asOf: at, cached: false, nextAt: at + STATUS_FLOOR_MS };
  }

  private pressFloor(key: string): Outcome<object> {
    const last = this.pressAt.get(key);
    const now = this.d.now();
    if (last !== undefined && now - last < PRESS_FLOOR_MS) {
      const s = Math.ceil((PRESS_FLOOR_MS - (now - last)) / 1000);
      return { ok: false, message: `That was asked less than a minute ago. Ask again in ${s} s.` };
    }
    this.pressAt.set(key, now);
    return { ok: true };
  }

  async start(n: string | undefined, mode: PermissionMode | undefined, keepRunning: boolean): Promise<Outcome<{ name: string; steps: Step[]; failed?: Step & { kind: 'failed' } }>> {
    const nm = this.name(n);
    if (!nm.ok) return nm;
    const f = this.pressFloor(`press:${nm.name}`);
    if (!f.ok) return f;
    const r = await this.gate({ verb: 'connect', name: nm.name, site: this.profile.site, mode: mode ?? this.profile.permissionMode, chain: keepRunning }, 180_000);
    if (!r.ok) return r;
    this.statusCache.delete(nm.name);
    const steps = r.out.split('\n').map(parseStepLine).filter((s): s is Step => s !== null);
    const failed = steps.find((s): s is Step & { kind: 'failed' } => s.kind === 'failed');
    if (!failed && !steps.some((s) => s.kind === 'queued' || s.kind === 'done')) {
      return { ok: false, message: "The grid didn't take the request." };
    }
    return { ok: true, name: nm.name, steps, failed };
  }

  async stop(n?: string): Promise<Outcome<{ name: string; line: string }>> {
    const nm = this.name(n);
    if (!nm.ok) return nm;
    const f = this.pressFloor(`press:${nm.name}`);
    if (!f.ok) return f;
    const r = await this.gate({ verb: 'stop', name: nm.name }, 120_000);
    if (!r.ok) return r;
    this.statusCache.delete(nm.name);
    const line = stoppedLine(r.out);
    if (!line) {
      if (/no worker named/.test(r.res.stderr)) return { ok: false, message: `There is no worker named "${nm.name}".` };
      return { ok: false, message: "The grid didn't confirm the stop." };
    }
    return { ok: true, name: nm.name, line };
  }

  private async floored<T>(key: string, fn: () => Promise<Outcome<T>>): Promise<Outcome<T & { asOf: number; cached: boolean }>> {
    const c = this.reads.get(key) as Cached<T> | undefined;
    const now = this.d.now();
    if (c && now - c.at < READ_FLOOR_MS) return { ok: true, ...c.value, asOf: c.at, cached: true };
    const r = await fn();
    if (!r.ok) return r;
    const at = this.d.now();
    const { ok: _ok, ...value } = r;
    this.reads.set(key, { at, value: value as T });
    return { ok: true, ...(value as T), asOf: at, cached: false };
  }

  async log(n: string | undefined, lines: number): Promise<Outcome<{ name: string; lines: string[]; asOf: number; cached: boolean }>> {
    const nm = this.name(n);
    if (!nm.ok) return nm;
    const all = await this.floored<{ name: string; all: string[] }>(`log:${nm.name}`, async () => {
      const r = await this.gate({ verb: 'read', name: nm.name, file: 'progress.log' }, 60_000);
      if (!r.ok) return r;
      if (r.res.code === 1 && /HPCW-GATE missing/.test(r.res.stderr)) return { ok: false, message: `The worker "${nm.name}" has no progress log yet.` };
      if (r.res.code === 3) return { ok: false, message: "The worker's progress log isn't a plain file, so Beethoven didn't read it." };
      return { ok: true, name: nm.name, all: progressLines(redact(r.out)) };
    });
    if (!all.ok) return all;
    return { ok: true, name: all.name, lines: all.all.slice(-lines), asOf: all.asOf, cached: all.cached };
  }

  // ---- the workspace, over sftp -----------------------------------------------------------------------

  private stateDir(n: string): string {
    const c = this.statusCache.get(n);
    // the grid's own answer names the state directory; before the first status, the profile's does
    return c?.value.state_dir && /^\/[^\0]*$/.test(c.value.state_dir) ? c.value.state_dir.replace(/\/+$/, '') : stateDirFor(this.profile, this.cfg.account);
  }

  private async withSftp<T>(fn: (s: Sftp) => Promise<Outcome<T>>): Promise<Outcome<T>> {
    const t = this.target();
    if (!t.ok) return t;
    return this.serial.run(async () => {
      const pin = await ensurePinned(this.route, t.t, this.profile.sshHostKey, this.d.run);
      if (!pin.ok) return { ok: false as const, message: this.pinMessage(pin.why) };
      let s: Sftp;
      try {
        s = await Sftp.start(this.d.spawnSftp(sftpArgv(this.route, t.t)));
      } catch (e) {
        const msg = e instanceof SftpError ? e.message : String(e);
        return { ok: false as const, message: /ENOENT/.test(msg) ? this.missingMessage() : `The grid's file session didn't start: ${redact(msg)}` };
      }
      try {
        return await fn(s);
      } catch (e) {
        if (e instanceof WorkspaceError) return { ok: false as const, message: e.message };
        return { ok: false as const, message: `The file session stopped: ${redact(e instanceof Error ? e.message : String(e))}` };
      } finally {
        s.close();
      }
    });
  }

  async list(n: string | undefined, rel: string): Promise<Outcome<Listing & { name: string; asOf: number; cached: boolean }>> {
    const nm = this.name(n);
    if (!nm.ok) return nm;
    return this.floored(`ls:${nm.name}:${rel}`, () =>
      this.withSftp(async (s) => {
        const ws = await openWorkspace(s, this.stateDir(nm.name), nm.name);
        return { ok: true as const, name: nm.name, ...(await listDir(s, ws, rel)) };
      }),
    );
  }

  async read(n: string | undefined, rel: string, maxBytes?: number): Promise<Outcome<FileText & { name: string; asOf: number; cached: boolean }>> {
    const nm = this.name(n);
    if (!nm.ok) return nm;
    return this.floored(`read:${nm.name}:${rel}:${maxBytes ?? ''}`, () =>
      this.withSftp(async (s) => {
        const ws = await openWorkspace(s, this.stateDir(nm.name), nm.name);
        return { ok: true as const, name: nm.name, ...(await readText(s, ws, rel, maxBytes)) };
      }),
    );
  }

  /** every worker of this account, from the status files alone: no gate line, no scheduler call */
  async workers(): Promise<Outcome<{ workers: WorkerRow[]; truncated: boolean; asOf: number; cached: boolean }>> {
    return this.floored('workers', () =>
      this.withSftp(async (s) => ({ ok: true as const, ...(await listWorkers(s, this.stateDir(this.cfg.worker))) })),
    );
  }

  // ---- Open in Claude ---------------------------------------------------------------------------------

  async openInClaude(n?: string): Promise<Outcome<{ link: string; opened: boolean }>> {
    const st = await this.status(n);
    if (!st.ok) return st;
    const link = linkOf(st.s);
    if (!link) return { ok: false, message: 'The worker has no Claude link yet: it gets one when it comes online.' };
    const opened = await this.d.launch(openerArgv(this.d.platform, link));
    return { ok: true, link, opened };
  }
}

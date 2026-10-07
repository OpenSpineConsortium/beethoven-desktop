// The server's grid side against a real sshd of this account on 127.0.0.1 (test/lab.ts): the pinned host
// key, the sign-in in a "terminal" that outlives its window, each gate verb over the kept sign-in, the
// floors, the workspace over sshd's own sftp-server with a worker that plants links and credentials, and
// the sign-out. By default the shared copy is the gate stand-in; where a person fetched hpcworker's pinned
// `framework` and `testbed` exports (bash interface/pull.sh --pinned test/hpcworker-testbed
// test/hpcworker-framework), the last block runs the real framework's gate behind the same sshd. The
// clock is the test's: floors are crossed by moving it, never by waiting.
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Config } from '../src/config.js';
import { Grid, realDeps, type Deps } from '../src/grid.js';
import { loadProfile, profileFrom } from '../src/profile.js';
import { launch } from '../src/terminal.js';
import { parseStepLine } from '../src/contract.js';
import { labMissing, realGateMissing, startLab, type Lab } from './lab.js';
import { importOf, ROOT } from './origin.js';

const missing = labMissing();
// the lane is opt-in: it runs where the pinned programs were fetched, and says why when it does not
const realMissing = missing ?? realGateMissing();
const skipped = (title: string, why: string | null) => (why ? `${title} (skipped: ${why})` : title);

interface Rig {
  grid: Grid;
  clock: { t: number };
  launched: string[][];
}

function rig(lab: Lab, over: { profile?: Record<string, unknown>; home?: string } = {}): Rig {
  const clock = { t: Date.parse('2026-10-04T12:00:00Z') };
  const launched: string[][] = [];
  const d: Deps = {
    ...realDeps,
    // the terminal is the lab's fake one; any other program (the link opener) is only recorded
    launch: async (argv) => {
      launched.push(argv);
      return existsSync(join(lab.fakeTerm, argv[0]!)) ? launch([join(lab.fakeTerm, argv[0]!), ...argv.slice(1)]) : true;
    },
    now: () => clock.t,
    sleep: async (ms) => {
      await new Promise((r) => setTimeout(r, Math.min(ms, 300)));
      clock.t += ms;
    },
    platform: 'linux',
    home: over.home ?? lab.localHome,
    env: { ...process.env, PATH: lab.fakeTerm },
  };
  const cfg: Config = { site: lab.site, account: lab.account, worker: 'worker', useWsl: false, sshPath: lab.ssh };
  const profile = over.profile ? profileFrom(over.profile, lab.site) : loadProfile(lab.site, lab.profiles);
  return { grid: new Grid(cfg, profile, d), clock, launched };
}

function calls(lab: Lab): string[] {
  const f = join(lab.state, 'calls');
  return existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean) : [];
}

function commandSessions(lab: Lab): number {
  return (readFileSync(lab.sshdLog, 'utf8').match(/Starting session: command for /g) ?? []).length;
}

describe.skipIf(missing)(skipped('the grid over a real sshd (gate stand-in)', missing), () => {
  let lab: Lab;
  let r: Rig;

  beforeAll(async () => {
    lab = await startLab({ bashrc: 'echo "bashrc says hello"\n' });
    r = rig(lab);
  }, 60_000);
  afterAll(() => lab?.stop());

  it('refuses a wrong host key before anything about the student is sent', async () => {
    const other = rig(lab, { profile: { ...lab.profileRaw, ssh_host_key: 'SHA256:' + 'A'.repeat(43) }, home: join(lab.dir, 'otherhome') });
    mkdirSync(join(lab.dir, 'otherhome'), { recursive: true });
    const v = await other.grid.version();
    expect(v.ok).toBe(false);
    expect(!v.ok && v.message).toMatch(/key Beethoven doesn't know/);
    expect(calls(lab)).toEqual([]);
    // the key scan is anonymous: sshd never saw a user name
    expect(readFileSync(lab.sshdLog, 'utf8')).not.toMatch(new RegExp(`(?:Accepted|Failed|Invalid user).*\\b${lab.account}\\b`));
  });

  it('without the kept sign-in, a call is refused at once and never prompts', async () => {
    expect(await r.grid.signedIn()).toBe(false);
    const t0 = Date.now();
    const v = await r.grid.version();
    expect(v.ok).toBe(false);
    expect(!v.ok && v.message).toMatch(/not signed in to the grid.*grid_sign_in/);
    expect(Date.now() - t0).toBeLessThan(20_000);
    expect(calls(lab)).toEqual([]);
    // pinned on the way: the known_hosts file of our own folder holds the grid's key and nothing else
    const kh = readFileSync(join(lab.localHome, '.beethoven-desktop', 'known_hosts'), 'utf8').trim().split('\n');
    expect(kh.length).toBeGreaterThan(0);
    for (const l of kh) expect(l.startsWith(`[127.0.0.1]:${lab.port} `)).toBe(true);
  });

  it('signs in through the terminal, and the sign-in outlives the window', async () => {
    const s = await r.grid.signIn();
    expect(s).toMatchObject({ ok: true, already: false, opened: true, signedIn: true });
    expect(r.launched[0]?.[0]).toBe('x-terminal-emulator');
    const launcher = r.launched[0]![2]!;
    const text = readFileSync(launcher, 'utf8');
    expect(text).toMatch(/^#!\/bin\/sh\n/);
    expect(text).toContain('ControlPersist=4h');
    expect(text).not.toMatch(/BatchMode|PasswordAuthentication|askpass|sshpass/i);
    // the fake window's input ends after six seconds, as when the student closes it
    await new Promise((res) => setTimeout(res, 8_000));
    expect(await r.grid.signedIn()).toBe(true);
    const again = await r.grid.signIn();
    expect(again).toMatchObject({ ok: true, already: true, opened: false });
    expect(r.launched.length).toBe(1);
  }, 60_000);

  it('asks the gate its version over the kept sign-in, through a ~/.bashrc that prints', async () => {
    const v = await r.grid.version();
    expect(v).toMatchObject({ ok: true, v: { framework: '16', account: lab.account, claude: 'yes' } });
    expect(calls(lab)).toEqual(['version']);
  });

  it('a worker with no run yet: status says so', async () => {
    const s = await r.grid.status();
    expect(s.ok).toBe(false);
    expect(!s.ok && s.message).toMatch(/no worker named "worker"/);
  });

  it('starts the worker with one connect line, never asking for a Claude sign-in', async () => {
    const s = await r.grid.start(undefined, undefined, true);
    expect(s.ok).toBe(true);
    if (!s.ok) return;
    expect(s.steps.map((x) => x.kind)).toContain('queued');
    expect(s.failed).toBeUndefined();
    expect(calls(lab).at(-1)).toBe(`connect worker ${lab.site} - default chain`);
  });

  it('the start and stop floor: a second press within the minute is refused here, not sent', async () => {
    const n = calls(lab).length;
    const s = await r.grid.stop();
    expect(s.ok).toBe(false);
    expect(!s.ok && s.message).toMatch(/less than a minute ago/);
    expect(calls(lab).length).toBe(n);
  });

  it('reads the status and the link, and gives the same answer again within the minute', async () => {
    const run = join(lab.state, 'worker');
    writeFileSync(join(run, 'status.json'), JSON.stringify({
      state: 'online', job: '40501234', node: 'asx15', online_at: '2026-10-04T12:00:30Z',
      environment_url: 'https://claude.ai/code?environment=env_01TestEnvironment', session_name: 'asx15-quiet-lake',
      claude_login: { loggedIn: true, subscriptionType: 'max', email: 'student@example.edu' },
    }));
    const a = await r.grid.status();
    expect(a).toMatchObject({ ok: true, cached: false, s: { run: 'worker', status: { state: 'online', node: 'asx15' } } });
    const n = calls(lab).length;
    r.clock.t += 30_000;
    const b = await r.grid.status();
    expect(b).toMatchObject({ ok: true, cached: true });
    expect(calls(lab).length).toBe(n);
    const o = await r.grid.openInClaude();
    expect(o).toMatchObject({ ok: true, link: 'https://claude.ai/code?environment=env_01TestEnvironment', opened: true });
    expect(r.launched.at(-1)).toEqual(['xdg-open', 'https://claude.ai/code?environment=env_01TestEnvironment']);
    expect(calls(lab).length).toBe(n);
  });

  it('a link that is not a Claude Code link is never opened', async () => {
    writeFileSync(join(lab.state, 'worker', 'status.json'), JSON.stringify({ state: 'online', environment_url: 'https://evil.example/code?environment=env_x' }));
    r.clock.t += 61_000;
    const n = r.launched.length;
    const o = await r.grid.openInClaude();
    expect(o.ok).toBe(false);
    expect(r.launched.length).toBe(n);
  });

  it('reads the progress log', async () => {
    const l = await r.grid.log(undefined, 10);
    expect(l.ok).toBe(true);
    if (!l.ok) return;
    expect(l.lines.join('\n')).toContain('Asked the grid for a computer');
    expect(calls(lab).at(-1)).toBe('read worker progress.log');
  });

  it('lists every worker from its own status file, with no gate line and no scheduler call', async () => {
    const helper = join(lab.state, 'helper');
    mkdirSync(helper, { recursive: true });
    writeFileSync(join(helper, 'status.json'), JSON.stringify({
      state: 'online', job: '40509999', node: 'asx10', environment_url: 'https://claude.ai/code?environment=env_01Helper',
      claude_login: { loggedIn: true, subscriptionType: 'max', email: 'second@example.edu' },
    }));
    writeFileSync(join(helper, 'job.token'), 'never-read');
    // not workers: a folder with no status file, and a run folder that is a link to somewhere else
    mkdirSync(join(lab.state, 'notes'), { recursive: true });
    mkdirSync(join(lab.home, 'elsewhere'), { recursive: true });
    writeFileSync(join(lab.home, 'elsewhere', 'status.json'), JSON.stringify({ state: 'online' }));
    symlinkSync(join(lab.home, 'elsewhere'), join(lab.state, 'linked'));
    const n = calls(lab).length;
    const w = await r.grid.workers();
    expect(w.ok, !w.ok ? w.message : '').toBe(true);
    if (!w.ok) return;
    expect(w.workers.map((x) => x.name)).toEqual(['helper', 'worker']);
    expect(w.workers[0]).toMatchObject({ state: 'online', node: 'asx10', claude_account: 'second@example.edu', link: 'https://claude.ai/code?environment=env_01Helper' });
    expect(w.workers[1]).toMatchObject({ state: 'online', link: null });
    expect(calls(lab).length).toBe(n);
    expect(await r.grid.workers()).toMatchObject({ ok: true, cached: true });
  });

  describe('the workspace, over sftp', () => {
    beforeAll(() => {
      const ws = join(lab.state, 'workspaces', 'worker');
      mkdirSync(join(ws, 'src'), { recursive: true });
      writeFileSync(join(ws, 'README.md'), '# the study\n');
      writeFileSync(join(ws, 'src', 'main.py'), 'print("hello")\n');
      writeFileSync(join(ws, 'notes.txt'), 'the token was sk-ant-oat01-' + 'x'.repeat(60) + ' and the commit 0123456789abcdef0123456789abcdef01234567\n');
      writeFileSync(join(ws, 'blob.bin'), Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0, 0, 1, 2]));
      writeFileSync(join(ws, '.credentials.json'), '{"claudeAiOauth":{"accessToken":"sk-ant-oat01-secret"}}');
      // what an agent could plant: a link to a credential outside, and a folder link out of the workspace
      mkdirSync(join(lab.home, 'cfg'), { recursive: true });
      writeFileSync(join(lab.home, 'cfg', 'secret.txt'), 'outside the workspace\n');
      symlinkSync(join(lab.home, 'cfg', 'secret.txt'), join(ws, 'looks-plain.txt'));
      symlinkSync(join(lab.home, 'cfg'), join(ws, 'outdir'));
    });

    it('lists the root, marking the credential name and the links', async () => {
      const l = await r.grid.list(undefined, '');
      expect(l.ok, !l.ok ? l.message : '').toBe(true);
      if (!l.ok) return;
      const by = Object.fromEntries(l.entries.map((e) => [e.name, e]));
      expect(by['README.md']).toMatchObject({ kind: 'file', readable: true });
      expect(by['src']).toMatchObject({ kind: 'dir' });
      expect(by['.credentials.json']).toMatchObject({ readable: false });
      expect(by['looks-plain.txt']).toMatchObject({ kind: 'link', readable: false });
      expect(by['outdir']).toMatchObject({ kind: 'link' });
    });

    it('reads a plain file and one in a folder', async () => {
      expect(await r.grid.read(undefined, 'README.md')).toMatchObject({ ok: true, text: '# the study\n', binary: false });
      expect(await r.grid.read(undefined, 'src/main.py')).toMatchObject({ ok: true, path: 'src/main.py', text: 'print("hello")\n' });
    });

    it('redacts credential-shaped text and keeps a commit id', async () => {
      const f = await r.grid.read(undefined, 'notes.txt');
      expect(f.ok).toBe(true);
      if (!f.ok) return;
      expect(f.text).not.toContain('sk-ant-oat01-x');
      expect(f.text).toContain('0123456789abcdef0123456789abcdef01234567');
    });

    it('says a binary file is binary and shows none of it', async () => {
      expect(await r.grid.read(undefined, 'blob.bin')).toMatchObject({ ok: true, binary: true, shown: 0, text: '' });
    });

    it('refuses the credential name, a planted link, a folder link out, and every path trick', async () => {
      for (const [p, re] of [
        ['.credentials.json', /never opens a file of that name/],
        ['looks-plain.txt', /is a link/],
        ['outdir/secret.txt', /outside the workspace/],
        ['../../home/cfg/secret.txt', /may not use/],
        ['/etc/passwd', /inside the workspace/],
        ['src/../../x', /may not use/],
      ] as const) {
        const f = await r.grid.read(undefined, p);
        expect(f.ok, p).toBe(false);
        expect(!f.ok && f.message, p).toMatch(re);
      }
      const l = await r.grid.list(undefined, 'outdir');
      expect(l.ok).toBe(false);
      expect(!l.ok && l.message).toMatch(/outside the workspace/);
    });

    it("the file session is sshd's sftp subsystem, and started no command", () => {
      const log = readFileSync(lab.sshdLog, 'utf8');
      expect(log).toMatch(/Starting session: subsystem 'sftp' for /);
      expect(commandSessions(lab)).toBe(calls(lab).length);
    });
  });

  it('stops the worker once the minute has passed; nothing is deleted', async () => {
    r.clock.t += 61_000;
    const s = await r.grid.stop();
    expect(s).toMatchObject({ ok: true, name: 'worker' });
    expect(s.ok && s.line).toMatch(/^worker worker: stopped \(/);
    expect(calls(lab).at(-1)).toBe('stop worker');
    expect(existsSync(join(lab.state, 'workspaces', 'worker', 'README.md'))).toBe(true);
  });

  it('every command the grid ran was one gate line', () => {
    for (const c of calls(lab)) expect(c).toMatch(/^(?:version|status worker|stop worker|read worker progress\.log|connect worker \S+ - default chain)$/);
    // sshd does not log a command's text, so count: each command session is one line the gate wrote down
    expect(commandSessions(lab)).toBe(calls(lab).length);
  });

  it('signs out; afterwards a call is refused without a prompt', async () => {
    expect(await r.grid.signOut()).toMatchObject({ ok: true, was: true });
    expect(await r.grid.signedIn()).toBe(false);
    const v = await r.grid.version();
    expect(!v.ok && v.message).toMatch(/not signed in/);
  });
});

describe.skipIf(realMissing)(skipped('the real hpcworker gate behind the same sshd', realMissing), () => {
  let lab: Lab;
  let r: Rig;

  beforeAll(async () => {
    lab = await startLab({ gate: 'real', bashrc: 'echo "bashrc says hello"\n' });
    r = rig(lab);
    const s = await r.grid.signIn();
    expect(s).toMatchObject({ ok: true, signedIn: true });
  }, 90_000);
  afterAll(() => {
    if (lab) expect(existsSync(join(lab.dir, 'GUARD-FIRED'))).toBe(false);
    lab?.stop();
  });

  it('version: the pinned framework answers', async () => {
    const v = await r.grid.version();
    const pinned = readFileSync(join(ROOT, importOf('test/hpcworker-framework').into, 'VERSION'), 'utf8').trim();
    expect(v).toMatchObject({ ok: true, v: { account: lab.account, framework: pinned } });
  });

  it('connect through the gate, then status, log and stop', async () => {
    const s = await r.grid.start(undefined, undefined, false);
    expect(s.ok, !s.ok ? s.message : '').toBe(true);
    // the steps the contract's gate-connect vector printed, and never a sign-in
    const vector = JSON.parse(readFileSync(join(ROOT, 'contract', 'vectors', 'gate-connect.json'), 'utf8')) as { stdout: string[] };
    expect(s.ok && s.steps.map((x) => x.kind)).toEqual(vector.stdout.map((l) => parseStepLine(l)?.kind));
    expect(s.ok && s.steps.some((x) => x.kind === 'signin')).toBe(false);
    const st = await r.grid.status();
    expect(st).toMatchObject({ ok: true, s: { run: 'worker', status: { state: 'queued' } } });
    const l = await r.grid.log(undefined, 20);
    expect(l.ok).toBe(true);
    r.clock.t += 61_000;
    const stop = await r.grid.stop();
    expect(stop.ok, !stop.ok ? stop.message : '').toBe(true);
  }, 240_000);

  it('the worker the real framework queued is in the list of all workers', async () => {
    const w = await r.grid.workers();
    expect(w.ok, !w.ok ? w.message : '').toBe(true);
    expect(w.ok && w.workers.map((x) => x.name)).toEqual(['worker']);
  });

  it('the workspace the real framework made is listed over sftp', async () => {
    const l = await r.grid.list(undefined, '');
    expect(l.ok, !l.ok ? l.message : '').toBe(true);
  });
});

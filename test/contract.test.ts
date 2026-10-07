// hpcworker's `contract` export, pinned in contract/ (and its `contract-text` in contract-text/), against
// this edition (the interface standard's rule 4): every pattern, word and number src/contract.ts types by
// hand is the pinned one; every line this edition types is one cli.json lists; and every vector this
// edition reads goes through the parser that reads it, the gate's answers through the real Grid behind
// an ssh that answers with the vector, with the outcome asserted. The expected values are taken from the
// export wherever it states them, so a new pull that moves one fails here until the code moves too.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { Config } from '../src/config.js';
import {
  cleanLine, FAIL_CODES, GATE_FILES, GATE_LINES, GATE_READ_EXIT, gateCommand, gateRemoteLine, isClaudeCodeLink, KEEPALIVE, KEY_EXPIRED, linkOf,
  parseStatusJson, parseStepLine, PERMISSION_MODES, PROGRESS_LINE, progressLines, SITE_RE, STEP_LINES, STOPPED_LINE, stoppedLine,
  WORKER_NAME_RE, type GateFile, type GateLine, type PermissionMode, type StatusJson,
} from '../src/contract.js';
import { Grid, realDeps, type Deps } from '../src/grid.js';
import { profileFrom } from '../src/profile.js';
import { rowOf } from '../src/runs.js';
import { childEnv, fingerprintOf } from '../src/ssh.js';
import { describeStatus, REPORTING, tools } from '../src/tools.js';
import { ROOT } from './origin.js';

// the export's files, read as the plain JSON they are
type Json = any;
const read = (dir: string, f: string): string => readFileSync(join(ROOT, dir, f), 'utf8');
const json = (f: string): Json => JSON.parse(read('contract', f));
const cli = json('cli.json');
const lines = json('lines.json');
const rules = json('rules.json');
const statusSchema = json('status.schema.json');
const connectionSchema = json('connection.schema.json');
const workerStatusSchema = json('worker-status.schema.json');

interface Vector {
  vector: string;
  kind: 'command' | 'file';
  command?: string;
  exit?: number;
  stdout?: string[];
  stderr?: string[];
  file?: string;
  json?: Json;
  lines?: string[];
}
const vectors = new Map<string, Vector>(
  readdirSync(join(ROOT, 'contract', 'vectors')).map((f) => {
    const v = json(`vectors/${f}`) as Vector;
    return [v.vector, v];
  }),
);
const V = (name: string): Vector => {
  const v = vectors.get(name);
  if (!v) throw new Error(`no vector ${name} in contract/vectors`);
  return v;
};
const esc = (t: string) => t.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
interface Family {
  lines: { id: string; pattern: string; exit?: number; groups?: string[] }[];
  [k: string]: Json;
}
const family = (id: string): Family => lines.families[id] as Family;
const lineOf = (fam: string, id: string) => family(fam).lines.find((l) => l.id === id)!;

// ---- the real Grid, behind an ssh that answers each gate line with a vector -----------------------------

const HOST_B64 = 'AAAAC3NzaC1lZDI1NTE5AAAAIBCj/iayuSj3Fidk+gybZFVkRGUgZuPSuVKeM+iqcGM2';
const homes: string[] = [];
afterAll(() => {
  for (const h of homes) rmSync(h, { recursive: true, force: true });
});

interface Answer {
  exit: number;
  stdout: string[];
  stderr: string[];
}

function fakeGrid(answer: (line: string) => Answer) {
  const home = mkdtempSync(join(tmpdir(), 'bd-contract-'));
  homes.push(home);
  const wayne = JSON.parse(read('profiles', 'wayne.json')) as Record<string, unknown>;
  const profile = profileFrom({ ...wayne, ssh_host_key: fingerprintOf(HOST_B64) }, 'wayne');
  const sent: string[] = [];
  const clock = { t: Date.parse('2026-10-01T12:00:00Z') };
  const d: Deps = {
    ...realDeps,
    run: async (argv) => {
      if (argv[0] === 'ssh-keyscan') return { code: 0, stdout: `grid ssh-ed25519 ${HOST_B64}\n`, stderr: '', timedOut: false, missing: false };
      // the remote line is the last word of the ssh: the gate of the lab's copy, the line in SSH_ORIGINAL_COMMAND
      const m = /^env SSH_ORIGINAL_COMMAND='([^']*)' bash '\/[^']+\/bin\/hpcworker' gate$/.exec(argv.at(-1)!);
      if (!m) throw new Error(`not a gate line: ${argv.at(-1)}`);
      sent.push(m[1]!);
      const a = answer(m[1]!);
      const text = (l: string[]) => l.map((x) => `${x}\n`).join('');
      return { code: a.exit, stdout: text(a.stdout), stderr: text(a.stderr), timedOut: false, missing: false };
    },
    launch: async () => true,
    now: () => clock.t,
    sleep: async (ms) => {
      clock.t += ms;
    },
    platform: 'linux',
    home,
    env: {},
  };
  const cfg: Config = { site: 'wayne', account: 'st1234', worker: 'worker', useWsl: false, sshPath: '' };
  return { grid: new Grid(cfg, profile, d), sent };
}

const answerOf = (v: Vector): Answer => ({ exit: v.exit!, stdout: v.stdout ?? [], stderr: v.stderr ?? [] });

/** the gate line a vector's command sent: SSH_ORIGINAL_COMMAND='<line>' hpcworker gate */
function gateLineOf(v: Vector): string {
  const m = /^SSH_ORIGINAL_COMMAND='([^']*)' hpcworker gate$/.exec(v.command ?? '');
  if (!m) throw new Error(`${v.vector} is not a gate command`);
  return m[1]!;
}

/** the same line as this edition would build it, or null when it never sends that line */
function asGateLine(line: string): GateLine | null {
  const w = line.split(' ');
  switch (w[0]) {
    case 'version':
      return { verb: 'version' };
    case 'status':
    case 'stop':
      return { verb: w[0], name: w[1]! };
    case 'read':
      return (GATE_FILES as readonly string[]).includes(w[2]!) ? { verb: 'read', name: w[1]!, file: w[2] as GateFile } : null;
    case 'connect':
      return w[3] === '-' ? { verb: 'connect', name: w[1]!, site: w[2]!, mode: w[4] as PermissionMode, chain: w[5] === 'chain' } : null;
    default:
      return null;
  }
}

// ---- cli.json ----------------------------------------------------------------------------------------------

/** a cli.json line template as a pattern: <a|b> is each value's pattern or enum, or the word itself */
function template(line: string): RegExp {
  const part = (alt: string): string => {
    const v = cli.values[alt];
    if (v?.pattern) return (v.pattern as string).replace(/^\^/, '').replace(/\$$/, '');
    if (v?.enum) return (v.enum as string[]).map(esc).join('|');
    return esc(alt);
  };
  const body = line.split(/(<[^>]+>)/).map((tok) => {
    const m = /^<(.+)>$/.exec(tok);
    return m ? `(?:${m[1]!.split('|').map(part).join('|')})` : esc(tok);
  }).join('');
  return new RegExp(`^${body}$`);
}

describe("cli.json: what this edition types", () => {
  it('the values it checks before it places them are the contract\'s', () => {
    expect(WORKER_NAME_RE.source).toBe(cli.values.gate_name.pattern);
    expect(SITE_RE.source).toBe(cli.values.site.pattern);
    expect([...PERMISSION_MODES]).toEqual(cli.values.permission_mode.enum);
    expect([...GATE_FILES]).toEqual(cli.values.gate_file.enum);
    // what a model may pass as a worker's name, and as a permission mode, is the same
    const { grid } = fakeGrid(() => ({ exit: 0, stdout: [], stderr: [] }));
    for (const t of tools(grid)) {
      const props = (t.inputSchema.properties ?? {}) as Record<string, { pattern?: string; enum?: string[] }>;
      if (props.name) expect(props.name.pattern, t.name).toBe(cli.values.gate_name.pattern);
      if (props.permission_mode) expect(props.permission_mode.enum, t.name).toEqual(cli.values.permission_mode.enum);
    }
  });

  it('every gate line it builds is one cli.json lists, and it builds none of the verbs it never sends', () => {
    const verbs = new Map<string, string>((cli.gate.verbs as { id: string; line: string }[]).map((v) => [v.id, v.line]));
    const built: GateLine[] = [
      { verb: 'version' },
      { verb: 'status', name: 'worker' },
      { verb: 'stop', name: 'A_b-1' },
      ...GATE_FILES.map((file) => ({ verb: 'read' as const, name: 'w'.repeat(32), file })),
      ...PERMISSION_MODES.flatMap((mode) => [true, false].map((chain) => ({ verb: 'connect' as const, name: 'gpu', site: 'wayne', mode, chain }))),
    ];
    for (const g of built) {
      const line = gateCommand(g);
      expect(verbs.has(g.verb), g.verb).toBe(true);
      expect(line, g.verb).toMatch(template(verbs.get(g.verb)!));
    }
    expect([...new Set(built.map((g) => g.verb))].sort()).toEqual(['connect', 'read', 'status', 'stop', 'version']);
    // the ones it never sends are in the contract, and nothing here can build them
    for (const v of ['forget', 'watch', 'restrict']) expect(verbs.has(v), v).toBe(true);
    // a name the contract refuses is refused here before anything is placed
    const gateName = new RegExp(cli.values.gate_name.pattern);
    for (const n of ['-x', '_x', 'a b', 'a;id', '$(id)', '', 'x'.repeat(33), 'x'.repeat(32), 'A', '0-_']) {
      expect(gateName.test(n), n).toBe(WORKER_NAME_RE.test(n));
      if (!gateName.test(n)) expect(() => gateCommand({ verb: 'status', name: n })).toThrow();
    }
  });

  it("runs the gate as the vectors ran it: the line in SSH_ORIGINAL_COMMAND, then `hpcworker gate`", () => {
    const gateVectors = [...vectors.values()].filter((v) => v.vector.startsWith('gate-'));
    expect(gateVectors.length).toBeGreaterThan(0);
    for (const v of gateVectors) {
      const line = gateLineOf(v);
      const g = asGateLine(line);
      if (v.vector === 'gate-refused') {
        // rc.log: a line the gate refuses is one this edition cannot build
        expect(g).toBeNull();
        expect(() => gateCommand({ verb: 'read', name: 'worker', file: line.split(' ')[2] as 'node' })).toThrow();
        continue;
      }
      expect(g, v.vector).not.toBeNull();
      expect(gateCommand(g!), v.vector).toBe(line);
      expect(gateRemoteLine('/rs/x/shared/current', g!)).toBe(`env SSH_ORIGINAL_COMMAND='${line}' bash '/rs/x/shared/current/bin/hpcworker' gate`);
    }
  });

  it("says the gate's limits with the contract's numbers", async () => {
    const words: Record<number, string> = { 2: 'two', 3: 'three', 12: 'twelve' };
    const limit = lineOf('gate', 'limit');
    expect(limit.exit).toBe(cli.gate.limits.exit);
    const said = async (which: string) => {
      const { grid } = fakeGrid(() => ({ exit: cli.gate.limits.exit, stdout: ['bashrc says hello', `HPCW-GATE limit ${which}`], stderr: [] }));
      const r = await grid.version();
      expect(r.ok).toBe(false);
      return r.ok ? '' : r.message;
    };
    expect(await said('names')).toContain(`${words[cli.gate.limits.names]} worker names`);
    expect(await said('hourly')).toContain(`${words[cli.gate.limits.connects_per_hour]} times in the last hour`);
    // every word the limit line may carry gets its own sentence, never the one for a refused line
    const refused = await (async () => {
      const { grid } = fakeGrid(() => ({ exit: lineOf('gate', 'refused').exit!, stdout: V('gate-refused').stdout!, stderr: [] }));
      const r = await grid.version();
      return r.ok ? '' : r.message;
    })();
    const which = /\(([a-z|]+)\)/.exec(limit.pattern)![1]!.split('|');
    expect(which.sort()).toEqual(['busy', 'hourly', 'names', 'watch']);
    for (const w of which) expect(await said(w), w).not.toBe(refused);
  });
});

// ---- lines.json ----------------------------------------------------------------------------------------------

describe('lines.json: the lines this edition reads', () => {
  it('reads a line as the contract says: terminal codes, carriage returns and a glued keepalive gone, trimmed', () => {
    expect(lines.description).toMatch(/strips terminal codes, drops a carriage return and trims; a glued keepalive is removed/);
    expect(KEEPALIVE).toBe(lines.families.login.keepalive);
    expect(cleanLine(' \x1b[1;32mHPCW-STEP done\x1b[0m\r')).toBe('HPCW-STEP done');
    expect(cleanLine(`HPCW-STEP ${KEEPALIVE}done`)).toBe('HPCW-STEP done');
    expect(cleanLine('\x1b]0;title\x07HPCW-GATE refused')).toBe('HPCW-GATE refused');
  });

  it('the step lines are the contract\'s patterns, and every failure code is one it prints', () => {
    const step = family('step');
    expect(Object.keys(STEP_LINES).sort()).toEqual(step.lines.map((l) => l.id).sort());
    for (const l of step.lines) expect(STEP_LINES[l.id as keyof typeof STEP_LINES].source, l.id).toBe(l.pattern);
    expect([...FAIL_CODES].sort()).toEqual(Object.keys(step.failure_codes).sort());
    expect(FAIL_CODES).toContain(step.unknown_code_reads_as);
    // a code the contract's grammar allows and this edition does not know reads as the contract says
    expect(parseStepLine('HPCW-STEP failed some-new-code why')).toEqual({ kind: 'failed', code: step.unknown_code_reads_as, sentence: 'why' });
  });

  it('every connect vector reads as the steps it printed, ending as its exit status says', () => {
    const step = family('step');
    const connects = [...vectors.values()].filter((v) => v.vector.startsWith('connect-') || v.vector === 'gate-connect');
    expect(connects.length).toBeGreaterThan(10);
    for (const v of connects) {
      const out = v.stdout!;
      const steps = out.map(parseStepLine).filter((s) => s !== null);
      // every HPCW-STEP line is read, and no other line (the sitting's, the scheduler's) is taken for one
      expect(steps.length, v.vector).toBe(out.filter((l) => l.startsWith('HPCW-STEP ')).length);
      const order = steps.map((s) => s!.kind).filter((k) => k !== 'failed').map((k) => step.order.indexOf(k));
      expect(order, v.vector).toEqual([...order].sort((a, b) => a - b));
      const last = steps.at(-1)!;
      if (v.exit === 0) {
        expect(last.kind, v.vector).toBe('done');
      } else {
        expect(last.kind, v.vector).toBe('failed');
        const code = (last as { code: string }).code;
        expect(step.failure_codes[code], `${v.vector}: ${code}`).toBe(v.exit);
        expect(v.vector).toBe(`connect-failed-${code}`);
      }
      // what each step carries is what the line says
      for (const l of out) {
        const s = parseStepLine(l);
        const m = s && s.kind === 'queued' ? new RegExp(lineOf('step', 'queued').pattern).exec(l) : null;
        if (m) expect(s).toEqual({ kind: 'queued', job: m[1], kept: m[2] === 'kept', runDir: m[3] ?? '' });
        const n = s && s.kind === 'signed-in' ? new RegExp(lineOf('step', 'signed-in').pattern).exec(l) : null;
        if (n) expect(s).toEqual({ kind: 'signed-in', email: n[1], plan: n[2] });
      }
    }
  });

  it("the gate's lines are the contract's patterns, with its exit statuses", () => {
    const gate = family('gate');
    expect(Object.keys(GATE_LINES).sort()).toEqual(gate.lines.map((l) => l.id).sort());
    for (const l of gate.lines) expect(GATE_LINES[l.id as keyof typeof GATE_LINES].source, l.id).toBe(l.pattern);
    for (const [k, exit] of Object.entries(GATE_READ_EXIT)) expect(exit, k).toBe(lineOf('gate', k).exit);
    expect(lineOf('gate', 'refused').exit).toBe(126);
    expect(cli.gate.description).toMatch(/HPCW-GATE refused, exit 126/);
    expect(KEY_EXPIRED.source).toBe(lineOf('key', 'expired').pattern);
  });

  it('progress.log\'s line is the contract\'s, and its vectors read whole', () => {
    expect(PROGRESS_LINE.source).toBe(family('progress').line_pattern);
    for (const name of ['progress-queued', 'progress-stopped']) {
      const v = V(name);
      expect(progressLines(['bashrc says hello', ...v.lines!, ''].join('\n')), name).toEqual(v.lines);
    }
  });

  it("the stop line, which lines.json does not carry, is the one contract-text gives the test of success for", () => {
    const v11 = read('contract-text', 'V11_CONTRACT.md');
    const v12 = read('contract-text', 'V12_CONTRACT.md');
    expect(v11).toMatch(new RegExp(`test of success: exit 0\\s+and \`/${esc(STOPPED_LINE.source)}/m\``));
    expect(v12).toMatch(/\| `stop NAME` \| `worker NAME: stopped \(\.\.\.\)` \|/);
    expect(stoppedLine('bashrc\nworker worker: stopped (request; the chain ended)\n')).toBe('worker worker: stopped (request; the chain ended)');
    expect(family('step').lines.some((l) => /stopped/.test(l.pattern))).toBe(false);
  });
});

// ---- the vectors, through the parsers and the Grid ------------------------------------------------------

describe('every vector this edition reads, through the code that reads it', () => {
  it('gate-version: the version, the account and the sign-in word, as the contract\'s groups name them', async () => {
    const v = V('gate-version');
    const ok = lineOf('gate', 'ok');
    const m = new RegExp(ok.pattern).exec(v.stdout![0]!)!;
    const g = (n: string) => m[ok.groups!.indexOf(n) + 1];
    const { grid, sent } = fakeGrid(() => answerOf(v));
    expect(await grid.version()).toEqual({ ok: true, v: { framework: g('framework'), account: g('account'), claude: g('claude') } });
    expect(sent).toEqual([gateLineOf(v)]);
  });

  it('gate-status and worker-status-queued: the one JSON line, whole, with every field the contract requires', async () => {
    const required = workerStatusSchema.$defs.fields.required as string[];
    for (const name of ['gate-status', 'worker-status-queued']) {
      const v = V(name);
      const { grid, sent } = fakeGrid(() => answerOf(v));
      const r = await grid.status();
      expect(r.ok, name).toBe(true);
      if (!r.ok) continue;
      const want = JSON.parse(v.stdout![0]!) as StatusJson;
      expect(r.s).toEqual(want);
      for (const k of required) expect(Object.keys(r.s), `${name}: ${k}`).toContain(k);
      expect(sent).toEqual(['status worker']);
      const d = describeStatus(r.s, 0, 60_000, false, 'Wayne State grid', '/rs/x/shared/current');
      expect(d.structured).toMatchObject({ name: want.run, state: want.status!.state, job: want.job, link: null });
      expect(d.text).toContain(`the scheduler says ${want.scheduler!.reason}`);
    }
  });

  it('worker-status-missing: no worker of that name, from its words on standard error', async () => {
    const v = V('worker-status-missing');
    expect(v.exit).toBe(1);
    expect(cli.commands.find((c: Json) => c.id === 'worker-status').exit['1']).toMatch(/no such worker \(stderr\)/);
    const { grid } = fakeGrid(() => answerOf(v));
    const r = await grid.status();
    expect(r.ok).toBe(false);
    expect(!r.ok && r.message).toMatch(/^There is no worker named "worker" yet/);
  });

  it('gate-connect and every connect vector: the start reads its steps and its failure', async () => {
    for (const v of [...vectors.values()].filter((x) => x.vector.startsWith('connect-') || x.vector === 'gate-connect')) {
      const { grid, sent } = fakeGrid(() => answerOf(v));
      const r = await grid.start(undefined, undefined, true);
      expect(r.ok, v.vector).toBe(true);
      if (!r.ok) continue;
      expect(r.steps.map((s) => s.kind), v.vector).toEqual(v.stdout!.map(parseStepLine).filter((s) => s !== null).map((s) => s!.kind));
      if (v.exit === 0) expect(r.failed, v.vector).toBeUndefined();
      else expect(r.failed?.code, v.vector).toBe(v.vector.replace(/^connect-failed-/, ''));
      expect(sent).toEqual(['connect worker wayne - default chain']);
    }
    expect(gateLineOf(V('gate-connect'))).toMatch(template(cli.gate.verbs.find((x: Json) => x.id === 'connect').line));
  });

  it('gate-read-progress and gate-read-missing: the log, and the missing one with its exit status', async () => {
    const p = V('gate-read-progress');
    const a = fakeGrid(() => answerOf(p));
    expect(await a.grid.log(undefined, 40)).toMatchObject({ ok: true, name: 'worker', lines: p.stdout });
    expect(a.sent).toEqual([gateLineOf(p)]);
    const m = V('gate-read-missing');
    expect(m.exit).toBe(GATE_READ_EXIT.missing);
    const b = fakeGrid(() => answerOf(m));
    const r = await b.grid.log(undefined, 40);
    expect(!r.ok && r.message).toMatch(/has no progress log yet/);
    // not-plain and too-large come with the same status, told apart by their line
    for (const [why, re] of [['not-plain', /isn't a plain file/], ['too-large', /larger than the grid hands over/]] as const) {
      const c = fakeGrid(() => ({ exit: GATE_READ_EXIT[why], stdout: [], stderr: [`HPCW-GATE ${why}`] }));
      const x = await c.grid.log(undefined, 40);
      expect(!x.ok && x.message, why).toMatch(re);
    }
  });

  it('gate-refused: the gate refused the line, said as such', async () => {
    const v = V('gate-refused');
    const { grid } = fakeGrid(() => answerOf(v));
    const r = await grid.version();
    expect(!r.ok && r.message).toMatch(/refused that request/);
  });

  it('a stop is a stop only with exit 0 and its line', async () => {
    const line = 'worker worker: stopped (request; the chain ended)';
    const a = fakeGrid(() => ({ exit: 0, stdout: [line], stderr: [] }));
    expect(await a.grid.stop()).toEqual({ ok: true, name: 'worker', line });
    const b = fakeGrid(() => ({ exit: 1, stdout: [line], stderr: [] }));
    expect((await b.grid.stop()).ok).toBe(false);
  });

  it('status-online, status-queued and status-stopped: the row of the worker list, and the link', () => {
    for (const name of ['status-online', 'status-queued', 'status-stopped']) {
      const j = V(name).json;
      const row = rowOf('worker', JSON.stringify(j));
      expect(row, name).toMatchObject({
        state: j.state, node: j.node, job: j.job, next_job: j.next_job, online_at: j.online_at ?? '', ends_at: j.ends_at ?? '', updated_at: j.updated_at,
        claude_account: j.claude_login?.email ?? '', claude_plan: j.claude_login?.subscriptionType ?? '', claude_signed_in: j.claude_login?.loggedIn ?? null,
        link: j.environment_url || null,
      });
      const s: StatusJson = { v: 1, run: 'worker', job: j.job, next_job: j.next_job, state_dir: '/scratch/state', status: j, connection: null, scheduler: null, line: '' };
      expect(linkOf(s), name).toBe(j.environment_url || null);
      const d = describeStatus(s, 0, 60_000, false, 'Wayne State grid', '/rs/x/shared/current');
      if (j.claude_login?.loggedIn) expect(d.text, name).toContain(`Signed in to Claude on the grid as ${j.claude_login.email} (${j.claude_login.subscriptionType})`);
    }
  });

  it('connection-online: the link from the connection file alone', () => {
    const j = V('connection-online').json;
    expect(linkOf({ v: 1, run: 'worker', job: j.job, next_job: '', state_dir: '/s', status: null, connection: j, scheduler: null, line: '' })).toBe(j.environment_url);
  });

  it('every Claude link in the vectors is one this edition opens, and the schemas\' link pattern agrees with it', () => {
    const schemaLink = new RegExp(connectionSchema.$defs.claude_link.pattern);
    const orEmpty = new RegExp(statusSchema.$defs.claude_link_or_empty.pattern);
    const found = new Set<string>();
    for (const v of vectors.values()) {
      for (const m of JSON.stringify(v).matchAll(/https:\/\/claude\.(?:ai|com)\/code[^"\s\\]*/g)) found.add(m[0]);
    }
    expect(found.size).toBeGreaterThan(0);
    const samples = [
      ...found, 'https://claude.com/code/session_01Abc', 'https://claude.ai/code?environment=env_x&y=1', 'https://evil.example/code?environment=env_1',
      ' https://claude.ai/code?environment=env_1', 'https://claude.ai/code?environment=env_', 'https://claude.ai/code/session_', 'http://claude.ai/code/session_1',
      'https://claude.ai/code?session=env_1', 'javascript:alert(1)',
    ];
    for (const u of samples) {
      expect(isClaudeCodeLink(u), u).toBe(schemaLink.test(u));
      expect(orEmpty.test(u), u).toBe(schemaLink.test(u));
    }
    for (const u of found) expect(isClaudeCodeLink(u), u).toBe(true);
  });
});

// ---- the schemas: the fields this edition names ------------------------------------------------------------

/** the keys an interface of src/contract.ts names, read from its text */
function keysOf(name: string): string[] {
  const src = readFileSync(join(ROOT, 'src', 'contract.ts'), 'utf8');
  const m = new RegExp(`export interface ${name}(?: extends [^{]+)? \\{\\n([\\s\\S]*?)\\n\\}`).exec(src);
  if (!m) throw new Error(`no interface ${name} in src/contract.ts`);
  return [...m[1]!.matchAll(/^ {2}([a-z_]+)\??:/gim)].map((x) => x[1]!);
}

describe('the schemas: every field this edition names is the contract\'s', () => {
  it('status.json, its claude_login, connection.json, and the status line with its scheduler', () => {
    const status = Object.keys(statusSchema.properties);
    for (const k of keysOf('StatusFile')) expect(status, `StatusFile.${k}`).toContain(k);
    const login = Object.keys(statusSchema.properties.claude_login.properties);
    for (const k of keysOf('ClaudeLogin')) expect(login, `ClaudeLogin.${k}`).toContain(k);
    const connection = Object.keys(connectionSchema.properties);
    for (const k of keysOf('ConnectionFile')) expect(connection, `ConnectionFile.${k}`).toContain(k);
    expect(keysOf('StatusJson').sort()).toEqual([...workerStatusSchema.$defs.fields.required].sort());
    const sched = /scheduler: \{ ([^}]+) \} \| null;/.exec(readFileSync(join(ROOT, 'src', 'contract.ts'), 'utf8'))![1]!.split(';').map((x) => x.trim().split(':')[0]!).filter(Boolean);
    expect(sched.sort()).toEqual([...workerStatusSchema.$defs.scheduler.required].sort());
    // the check reads what it says it reads
    expect(keysOf('StatusFile')).toContain('environment_url');
    expect(keysOf('ConnectionFile')).toContain('permission_mode');
  });

  it("the state words this edition acts on are status.json's", () => {
    const states = statusSchema.properties.state.enum as string[];
    for (const s of REPORTING) expect(states, s).toContain(s);
    // only the two that need the student get the line to type, and both are the contract's words
    const told = states.filter((state) => {
      const s: StatusJson = { v: 1, run: 'worker', job: '1', next_job: '', state_dir: '/s', status: { state }, connection: null, scheduler: null, line: '' };
      return /run this (?:once )?yourself/i.test(describeStatus(s, 0, 60_000, false, 'g', '/rs/x/shared/current').text);
    });
    expect(told).toEqual(['need_login', 'need_consent']);
    expect(statusSchema.properties.needs.enum).toEqual(expect.arrayContaining(['login', 'consent']));
  });
});

// ---- rules.json ----------------------------------------------------------------------------------------------

describe("rules.json: what this edition strips", () => {
  it('no child of this process gets a credential variable hpcworker strips', () => {
    const names = rules.credential_variables as string[];
    expect(names.length).toBeGreaterThan(10);
    const env = childEnv({ PATH: '/bin', HOME: '/h', ...Object.fromEntries(names.map((k) => [k, 'x'])) });
    for (const k of names) expect(env[k], k).toBeUndefined();
    expect(env).toEqual({ PATH: '/bin', HOME: '/h' });
  });
});

// ---- the stand-in the ssh tests run, held to the same contract ------------------------------------------

describe('test/gate-standin.sh prints what the contract says the gate prints', () => {
  const bash = spawnSync('bash', ['-c', 'exit 0']).status === 0;
  const state = mkdtempSync(join(tmpdir(), 'bd-standin-'));
  homes.push(state);
  const gate = (line: string) =>
    spawnSync('bash', [join(ROOT, 'test', 'gate-standin.sh'), 'gate'], { encoding: 'utf8', env: { PATH: process.env.PATH, SSH_ORIGINAL_COMMAND: line, STANDIN_STATE: state } });
  const out = (r: { stdout: string }) => r.stdout.split('\n').filter(Boolean);

  it.skipIf(!bash)('version, connect, status, read, stop, and a line it refuses', () => {
    const v = gate('version');
    expect(out(v)).toHaveLength(1);
    expect(out(v)[0]).toMatch(new RegExp(lineOf('gate', 'ok').pattern));

    const c = gate('connect worker wayne - default chain');
    expect(c.status).toBe(0);
    for (const l of out(c)) expect(family('step').lines.some((p) => new RegExp(p.pattern).test(l)), l).toBe(true);
    expect(out(c).at(-1)).toMatch(new RegExp(lineOf('step', 'done').pattern));

    mkdirSync(join(state, 'worker'), { recursive: true });
    writeFileSync(join(state, 'worker', 'status.json'), JSON.stringify(V('status-online').json));
    const s = parseStatusJson(gate('status worker').stdout);
    expect(s).not.toBeNull();
    for (const k of workerStatusSchema.$defs.fields.required as string[]) expect(Object.keys(s!), k).toContain(k);
    expect(s!.status).toEqual(V('status-online').json);

    const missing = gate('read worker node');
    expect([missing.status, missing.stderr.trim()]).toEqual([GATE_READ_EXIT.missing, 'HPCW-GATE missing']);
    const refused = gate('read worker rc.log');
    expect([refused.status, out(refused)]).toEqual([lineOf('gate', 'refused').exit, V('gate-refused').stdout]);
    const stop = gate('stop worker');
    expect([stop.status, stoppedLine(stop.stdout) !== null]).toEqual([0, true]);
  });
});

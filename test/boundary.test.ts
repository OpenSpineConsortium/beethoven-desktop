// The interface standard's rules 1 to 3 for this repository (interface/README.md): nothing here reads,
// runs or copies a file of another Beethoven repository's checkout; what it offers and takes is declared
// in interface/INTERFACE.json; and what it takes is a pinned copy that matches its ORIGIN. A line that
// reaches a sibling checkout fails unless it is on the known list below with its reason, and an entry
// that no longer matches fails too, so the list only shrinks. The patterns are hpcworker's
// framework/tests/test_boundary.py's, ported; no network and no secret.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SELF = 'beethoven-desktop';
const THIS = 'test/boundary.test.ts';
const STANDARD = 'https://github.com/OpenSpineConsortium/beethoven/blob/main/INTERFACES.md';
// every other repository of the ecosystem, the names their checkouts had (the Desktop folders ashley and
// ashley-bridge), and the website's
const OTHERS = [
  'beethoven', 'beethoven-extension', 'hpcworker', 'beethoven-qa', 'beethoven-agents', 'beethoven-research', 'beethoven-sites',
  'beethoven-base', 'beethoven-vscode', 'ashley', 'ashley-bridge', 'openspineconsortium.github.io', 'spinesurg-ct-nnunet',
  'u251-xenograft-rat-rnaseq-study',
];
const NAMES = [...OTHERS].sort((a, b) => b.length - a.length).map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
// a path made from this checkout's parent: "../<repo>", or "$(dirname ...)/<repo>", "${PARENT}/<repo>" and the like
const SIBLING_PATH = new RegExp(`(?:\\.\\./|\\)/|\\}/)(${NAMES})(?![A-Za-z0-9_.-])`, 'g');
// a variable whose value is another repository's checkout
const CHECKOUT_VAR = /\b((?:HPCWORKER|ASHLEY|SITES|QA|BEETHOVEN_(?:SERVICE|QA|AGENTS|RESEARCH|SITES|EXTENSION|DESKTOP|VSCODE|BASE|HUB))_DIR)\b/g;
// a clone of another repository of the organisation
const CLONE = new RegExp(`\\b(?:git clone|gh repo clone)\\b[^\\n]*?OpenSpineConsortium/(${NAMES})\\b`, 'gi');
// another repository's code imported: hpcworker's test modules, the engine's packages
const FOREIGN_MODULE = /\b(?:import|from)\s+(fakegrid|schemacheck|beethoven_(?:qa|agents|research))\b/g;
const PATTERNS = [SIBLING_PATH, CHECKOUT_VAR, CLONE, FOREIGN_MODULE];
const CHECKOUT_ACTION_REPO = /^\s*repository:\s*\S+/m;
// a dependency that is not a version from the registry: a path, a link, a git URL or a host's shorthand
const NOT_FROM_REGISTRY = /^(?:file:|link:|portal:|git[+:]|github:|gitlab:|bitbucket:|https?:|\.{0,2}\/|~\/)|^[^@\s/:]+\/[^\s/]+$/;

// [file, what matched, why it is still here and who removes it]
const KNOWN: [string, string, string][] = [
  ['test/lab.ts', 'HPCWORKER_DIR',
    'the opt-in real-gate lab copies framework/{bin,lib,jobs,profiles,VERSION,README.md} from a sibling hpcworker checkout; '
    + "Wave B takes hpcworker's `framework` program export instead, pinned with ORIGIN in a folder git ignores (interface/README.md), "
    + "and this repository's Wave B change removes the entry, after hpcworker's interface is merged"],
  ['test/lab.ts', 'fakegrid',
    "the same lab imports hpcworker's test-internal framework/tests/fakegrid.py from that checkout for its fake scheduler; "
    + "Wave B takes hpcworker's `testbed` program export instead and removes the entry with the one above"],
  ['test/grid.ssh.test.ts', 'HPCWORKER_DIR', 'the real-gate block runs only when HPCWORKER_DIR is set; it goes with the lab\'s entry in Wave B'],
  ['test/gate-standin.sh', 'HPCWORKER_DIR', 'a comment naming the real-gate lane; it goes with that lane in Wave B'],
  ['.github/workflows/ci.yml', 'HPCWORKER_DIR',
    'a comment saying CI cannot run the real-gate lane; a session cannot push a workflow file here, so the maintainer rewords it '
    + 'when Wave B lands'],
  ['.githooks/pre-push', 'HPCWORKER_DIR inherited',
    "the hook runs `npm run gate` in the pusher's environment, so a set HPCWORKER_DIR makes the push's verdict depend on a sibling "
    + "checkout's working tree; the hook's behaviour stays as it is in Wave A, and the entry goes stale when Wave B ends the "
    + 'variable in the tests'],
];

/** the repository's files: git's list where git is at hand, else the tree without .git, node_modules and dist */
function tracked(): string[] {
  const env = { ...process.env };
  // a hook's GIT_DIR (a linked worktree's) would aim git elsewhere than this checkout
  for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_PREFIX', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY']) delete env[k];
  const r = spawnSync('git', ['-C', ROOT, 'ls-files', '-z'], { env, encoding: 'utf8' });
  const files = r.status === 0 ? r.stdout.split('\0').filter(Boolean) : [];
  if (files.length) return files;
  const found: string[] = [];
  const walk = (d: string) => {
    for (const n of readdirSync(d)) {
      if (['.git', 'node_modules', 'dist'].includes(n)) continue;
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else found.push(relative(ROOT, p).split(sep).join('/'));
    }
  };
  walk(ROOT);
  return found;
}

function text(rel: string): string {
  try {
    const b = readFileSync(join(ROOT, rel));
    return b.includes(0) ? '' : b.toString('utf8');
  } catch {
    return '';
  }
}

/** (file, what matched) -> the first line where it did, for every reach of a sibling checkout in these files */
function reaches(files: Map<string, string>): Map<string, string> {
  const found = new Map<string, string>();
  for (const [rel, body] of files) {
    if (rel.endsWith('.md') || rel === THIS) continue; // prose may name another repository; this file names them to look for them
    body.split('\n').forEach((line, i) => {
      for (const rx of PATTERNS) {
        for (const m of line.matchAll(rx)) {
          const k = `${rel} | ${m[1]}`;
          if (!found.has(k)) found.set(k, `${rel}:${i + 1}: ${line.trim().slice(0, 160)}`);
        }
      }
    });
  }
  // the gate before every push runs the tests in the pusher's environment: while a test reads
  // HPCWORKER_DIR, a hook that does not drop it hands the push's verdict to a sibling checkout
  const hook = files.get('.githooks/pre-push');
  const reader = [...files].find(([rel, body]) => rel.startsWith('test/') && rel !== THIS && /process\.env\.HPCWORKER_DIR\b/.test(body));
  if (hook && reader && /\bnpm (?:run gate|test)\b/.test(hook) && !/(?:unset|env -u)\s+HPCWORKER_DIR\b/.test(hook)) {
    found.set('.githooks/pre-push | HPCWORKER_DIR inherited', `.githooks/pre-push runs the tests, and ${reader[0]} reads HPCWORKER_DIR`);
  }
  return found;
}

/** the standard's path rule: "dir/" every file under it, "*" within one part of a path */
function covered(rel: string, paths: string[]): boolean {
  return paths.some((p) => {
    if (p.endsWith('/')) return rel.startsWith(p);
    const re = new RegExp(`^${p.split('*').map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*')}$`);
    return re.test(rel);
  });
}

interface Import {
  repository: string;
  export: string;
  version: number;
  into: string;
  origin: string;
}

interface Manifest {
  format: number;
  name: string;
  repository: string;
  summary: string;
  standard: string;
  exports: { id: string; kind: string; version: number; summary: string; paths: string[]; consumers: string[] }[];
  imports: Import[];
}

function manifest(root = ROOT): Manifest {
  return JSON.parse(readFileSync(join(root, 'interface', 'INTERFACE.json'), 'utf8')) as Manifest;
}

const sha256 = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex');

/** what is wrong with one import's folder against its ORIGIN, in words; empty when it is the pinned copy */
function importProblems(imp: Import, root = ROOT): string[] {
  const out: string[] = [];
  const folder = join(root, imp.into);
  const originPath = join(root, imp.origin);
  if (!existsSync(originPath)) return [`${imp.origin} is missing`];
  const lines = readFileSync(originPath, 'utf8').split('\n').filter(Boolean);
  if (lines[0] !== `repository ${imp.repository}`) out.push(`${imp.origin}'s first line is not "repository ${imp.repository}"`);
  if (!/^commit [0-9a-f]{40}$/.test(lines[1] ?? '')) out.push(`${imp.origin}'s second line is not a commit`);
  const recorded = new Map<string, string>();
  for (const l of lines.slice(2)) {
    let m: RegExpExecArray | null;
    // a copy taken before its provider published INTERFACE.json has no export line; the next pull writes one
    if ((m = /^export (\S+) (\S+)$/.exec(l))) {
      if (m[1] !== imp.export || m[2] !== String(imp.version)) out.push(`${imp.origin} records export ${m[1]} ${m[2]}, the import is ${imp.export} ${imp.version}`);
    } else if ((m = /^sha256 ([0-9a-f]{64}) (\S(?:.*\S)?)$/.exec(l))) {
      recorded.set(m[2]!, m[1]!);
    } else {
      out.push(`${imp.origin} has a line the standard does not know: ${l}`);
    }
  }
  const present = new Map<string, string>();
  const walk = (d: string) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else present.set(relative(folder, p).split(sep).join('/'), sha256(p));
    }
  };
  if (existsSync(folder)) walk(folder);
  for (const own of ['ORIGIN', 'README.md', 'pull.sh']) present.delete(own);
  for (const [f, h] of present) {
    if (!recorded.has(f)) out.push(`${imp.into}/${f} is not in ${imp.origin} (a pull lists a file the provider dropped for a person to remove)`);
    else if (recorded.get(f) !== h) out.push(`${imp.into}/${f} differs from ${imp.origin}: take a new copy with its pull.sh, never edit one by hand`);
  }
  for (const f of recorded.keys()) if (!present.has(f)) out.push(`${imp.into}/${f} is in ${imp.origin} but not in the folder`);
  return out;
}

const all = tracked();
const bodies = new Map(all.map((rel) => [rel, text(rel)]));

describe('rule 1: the repository builds, tests and runs from its own tree', () => {
  it('no tracked file reaches a sibling checkout, but the known ones, each with its reason', () => {
    const found = reaches(bodies);
    const known = new Set(KNOWN.map(([f, w]) => `${f} | ${w}`));
    const fresh = [...found].filter(([k]) => !known.has(k)).map(([, where]) => where);
    expect(fresh, "these lines reach another repository's checkout; take what is needed from that repository's interface instead (interface/README.md)").toEqual([]);
    const stale = [...known].filter((k) => !found.has(k));
    expect(stale, 'fixed: remove these from KNOWN in test/boundary.test.ts').toEqual([]);
    for (const [, , why] of KNOWN) expect(why.length).toBeGreaterThan(40);
  });

  it('the patterns find what they look for, and not this repository\'s own paths', () => {
    const sample = new Map([
      ['a.sh', 'cp -r ../hpcworker/framework .\nREPO="$(dirname "$HERE")/beethoven-extension"\nX=${PARENT}/beethoven-qa/src'],
      ['b.sh', 'HPCWORKER_DIR=../x npm test\nexport BEETHOVEN_SERVICE_DIR'],
      ['c.yml', 'run: git clone https://github.com/OpenSpineConsortium/beethoven-agents x'],
      ['d.ts', "'import fakegrid as G',\nfrom beethoven_qa.contracts import x"],
      ['e.ts', "import { x } from '../src/contract.js';\nconst p = '/rs/rs_grp_oschome/shared/beethoven/hpcworker/current';\n`bash ${sharedInstall}/bin/hpcworker claude login`\n~/.hpcworker and ../hpcworker-notes"],
    ]);
    expect([...reaches(sample).keys()].sort()).toEqual([
      'a.sh | beethoven-extension', 'a.sh | beethoven-qa', 'a.sh | hpcworker', 'b.sh | BEETHOVEN_SERVICE_DIR', 'b.sh | HPCWORKER_DIR',
      'c.yml | beethoven-agents', 'd.ts | beethoven_qa', 'd.ts | fakegrid',
    ]);
  });

  it('no submodule, and no workflow checks out another repository', () => {
    expect(existsSync(join(ROOT, '.gitmodules'))).toBe(false);
    expect(all).not.toContain('.gitmodules');
    for (const rel of all.filter((f) => f.startsWith('.github/workflows/'))) {
      expect(CHECKOUT_ACTION_REPO.test(bodies.get(rel) ?? ''), `${rel} checks out another repository`).toBe(false);
    }
  });

  it('every dependency is a version from the registry, never a path, a link or a git URL', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as Record<string, unknown>;
    expect(pkg.workspaces).toBeUndefined();
    for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies', 'bundleDependencies', 'overrides']) {
      for (const [name, spec] of Object.entries((pkg[field] ?? {}) as Record<string, unknown>)) {
        expect(typeof spec === 'string' && !NOT_FROM_REGISTRY.test(spec), `${field} ${name}: ${String(spec)}`).toBe(true);
      }
    }
    const lock = JSON.parse(readFileSync(join(ROOT, 'package-lock.json'), 'utf8')) as { packages: Record<string, { resolved?: string; link?: boolean }> };
    for (const [where, p] of Object.entries(lock.packages)) {
      expect(p.link, `${where} is a link`).not.toBe(true);
      if (p.resolved !== undefined) expect(p.resolved, where).toMatch(/^https:\/\/registry\.npmjs\.org\//);
    }
    for (const bad of ['file:../hpcworker', 'link:../beethoven-base', 'github:OpenSpineConsortium/beethoven-base', 'OpenSpineConsortium/beethoven-base', 'git+https://github.com/OpenSpineConsortium/x.git', '../x', '~/beethoven-base']) {
      expect(NOT_FROM_REGISTRY.test(bad), bad).toBe(true);
    }
    for (const good of ['5.9.3', '^1.2.0', '~1.0.0', 'npm:vite@8.3.1', '>=18', 'latest']) expect(NOT_FROM_REGISTRY.test(good), good).toBe(false);
  });
});

describe('rule 2: what this repository offers and takes, declared in one place', () => {
  it('interface/INTERFACE.json has the standard\'s shape', () => {
    const m = manifest();
    expect(Object.keys(m).sort()).toEqual(['exports', 'format', 'imports', 'name', 'repository', 'standard', 'summary']);
    expect([m.format, m.name, m.repository, m.standard]).toEqual([1, SELF, `OpenSpineConsortium/${SELF}`, STANDARD]);
    expect(typeof m.summary === 'string' && m.summary.length > 0).toBe(true);
    const ids = m.exports.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const e of m.exports) {
      expect(Object.keys(e).sort()).toEqual(['consumers', 'id', 'kind', 'paths', 'summary', 'version']);
      expect(['contract', 'schema', 'data', 'python', 'cli', 'files', 'program', 'text']).toContain(e.kind);
      expect(Number.isInteger(e.version) && e.version >= 1).toBe(true);
      expect(e.paths.length).toBeGreaterThan(0);
      for (const p of e.paths) expect(p.startsWith('/') || p.split('/').includes('..'), p).toBe(false);
      for (const c of e.consumers) expect(c).toMatch(/^OpenSpineConsortium\/[a-z0-9.-]+$/);
    }
    const intos = m.imports.map((i) => i.into);
    expect(new Set(intos).size).toBe(intos.length);
    for (const i of m.imports) {
      expect(Object.keys(i).sort()).toEqual(['export', 'into', 'origin', 'repository', 'version']);
      expect(i.repository).toMatch(/^OpenSpineConsortium\/[a-z0-9.-]+$/);
      expect(i.repository).not.toBe(`OpenSpineConsortium/${SELF}`);
      expect(Number.isInteger(i.version) && i.version >= 1).toBe(true);
      expect(i.into).toMatch(/^[a-z0-9._-]+(?:\/[a-z0-9._-]+)*$/);
      expect(i.into.split('/')).not.toContain('..');
      expect(i.origin).toBe(`${i.into}/ORIGIN`);
    }
  });

  it('every export path names a file of this repository', () => {
    for (const e of manifest().exports) {
      for (const p of e.paths) expect(all.some((f) => covered(f, [p])), `${e.id}: ${p} names no file`).toBe(true);
    }
    // the rule itself, so an empty list of exports proves something
    expect(covered('profiles/wayne.json', ['profiles/*.json'])).toBe(true);
    expect(covered('profiles/x/wayne.json', ['profiles/*.json'])).toBe(false);
    expect(covered('profiles/wayneXjson', ['profiles/*.json'])).toBe(false);
    expect(covered('interface/contract/vectors/a.json', ['interface/contract/'])).toBe(true);
    expect(covered('interface/contractX', ['interface/contract/'])).toBe(false);
  });
});

describe('rule 3: an import is a pinned, checked copy', () => {
  it('each import folder holds exactly what its ORIGIN lists, byte for byte', () => {
    const m = manifest();
    expect(m.imports.length).toBeGreaterThan(0);
    for (const imp of m.imports) expect(importProblems(imp), imp.into).toEqual([]);
  });

  it('the check refuses an edited file, a file ORIGIN does not list, and another export', () => {
    // a check that passes everything proves nothing: each of these is named
    const imp = manifest().imports[0]!;
    const T = mkdtempSync(join(tmpdir(), 'bd-boundary-'));
    try {
      cpSync(join(ROOT, imp.into), join(T, imp.into), { recursive: true });
      expect(importProblems(imp, T)).toEqual([]);
      const first = readdirSync(join(T, imp.into)).find((n) => !['ORIGIN', 'README.md', 'pull.sh'].includes(n))!;
      writeFileSync(join(T, imp.into, first), readFileSync(join(T, imp.into, first), 'utf8') + ' ');
      writeFileSync(join(T, imp.into, 'extra.json'), '{}\n');
      writeFileSync(join(T, imp.origin), readFileSync(join(T, imp.origin), 'utf8') + `export ${imp.export} ${imp.version + 1}\n`);
      const p = importProblems(imp, T).join('\n');
      expect(p).toMatch(new RegExp(`${first.replace('.', '\\.')} differs`));
      expect(p).toMatch(/extra\.json is not in/);
      expect(p).toMatch(/records export/);
    } finally {
      rmSync(T, { recursive: true, force: true });
    }
  });

  const bash = spawnSync('bash', ['-c', 'exit 0']).status === 0 && spawnSync('node', ['-e', '0']).status === 0;
  describe.skipIf(!bash)('profiles/pull.sh, its parts that need no network', () => {
    const pull = join(ROOT, 'profiles', 'pull.sh');
    // the script's functions, with nothing run: it runs main only when it is not sourced
    const fn = (name: string, args: string[], input?: string) =>
      spawnSync('bash', ['-c', 'source "$1"; shift; "$@"', '_', pull, name, ...args], { encoding: 'utf8', input });

    it('refuses a word it does not know before it asks anything of GitHub', () => {
      // a gh that only says it was asked stands first on the PATH: the network is never reached from here
      const T = mkdtempSync(join(tmpdir(), 'bd-pull-'));
      try {
        writeFileSync(join(T, 'gh'), '#!/bin/sh\necho asked >&2\nexit 99\n', { mode: 0o755 });
        for (const args of [['--from', '../hpcworker'], ['--ref'], ['hpcworker']]) {
          const r = spawnSync('bash', [pull, ...args], { encoding: 'utf8', env: { ...process.env, PATH: `${T}:${process.env.PATH ?? ''}` } });
          expect([r.status, r.stderr.includes('asked')], args.join(' ')).toEqual([2, false]);
        }
      } finally {
        rmSync(T, { recursive: true, force: true });
      }
    });

    it('places each file at its path below the folder the export\'s paths share', () => {
      expect(fn('shared_base', ['framework/profiles/*.json']).stdout).toBe('framework/profiles/');
      expect(fn('shared_base', ['interface/contract/']).stdout).toBe('interface/contract/');
      expect(fn('shared_base', ['framework/bin/', 'framework/lib/', 'framework/VERSION']).stdout).toBe('framework/');
      expect(fn('placed', ['framework/profiles/', 'framework/profiles/wayne.json']).stdout).toBe('wayne.json');
      for (const [base, p] of [['framework/profiles/', 'framework/other.json'], ['framework/profiles/', 'framework/profiles/ORIGIN'], ['', '../x'], ['a/', 'a//b']]) {
        expect(fn('placed', [base!, p!]).status, `${base} ${p}`).not.toBe(0);
      }
      expect(fn('covered', ['framework/profiles/wayne.json', 'framework/profiles/*.json']).status).toBe(0);
      expect(fn('covered', ['framework/profiles/old/wayne.json', 'framework/profiles/*.json']).status).not.toBe(0);
      expect(fn('covered', ['framework/lib/profile.py', 'framework/profiles/*.json']).status).not.toBe(0);
    });

    it('takes the paths the provider\'s manifest lists for profiles version 1, and nothing else', () => {
      const offer = (exports: unknown) => fn('export_paths', [], JSON.stringify({ format: 1, exports }));
      const ok = offer([{ id: 'contract', version: 1, paths: ['interface/contract/'] }, { id: 'profiles', version: 1, paths: ['framework/profiles/*.json'] }]);
      expect([ok.status, ok.stdout]).toEqual([0, 'framework/profiles/*.json\n']);
      const v2 = offer([{ id: 'profiles', version: 2, paths: ['framework/profiles/*.json'] }]);
      expect(v2.status).not.toBe(0);
      expect(v2.stderr).toMatch(/profiles version 1 is not offered \(offered: profiles 2\)/);
      expect(offer([]).status).not.toBe(0);
      expect(offer([{ id: 'profiles', version: 1, paths: ['../hpcworker/framework/profiles/*.json'] }]).status).not.toBe(0);
      expect(offer([{ id: 'profiles', version: 1, paths: ['/etc/*.json'] }]).status).not.toBe(0);
      expect(fn('export_paths', [], 'not json').status).not.toBe(0);
    });
  });
});

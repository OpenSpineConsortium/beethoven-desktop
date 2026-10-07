// What this repository takes from another, read from interface/INTERFACE.json, and the check that an
// import's folder is the pinned copy its ORIGIN records (the interface standard's rule 3). The boundary
// test runs it on every import; the real-gate lab runs it on hpcworker's two programs before it runs
// either of them.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('..', import.meta.url));

export interface Import {
  repository: string;
  export: string;
  version: number;
  into: string;
  origin: string;
}

export interface Manifest {
  format: number;
  name: string;
  repository: string;
  summary: string;
  standard: string;
  exports: { id: string; kind: string; version: number; summary: string; paths: string[]; consumers: string[] }[];
  imports: Import[];
}

export function manifest(root = ROOT): Manifest {
  return JSON.parse(readFileSync(join(root, 'interface', 'INTERFACE.json'), 'utf8')) as Manifest;
}

export function importOf(into: string, root = ROOT): Import {
  const imp = manifest(root).imports.find((i) => i.into === into);
  if (!imp) throw new Error(`interface/INTERFACE.json has no import into ${into}`);
  return imp;
}

/** the imports git ignores but for their ORIGIN: programs only the opt-in real-gate lane runs, which a person fetches */
export const FETCHED = ['test/hpcworker-testbed', 'test/hpcworker-framework'];

/** how to fetch them, in the words a skipped test says */
export const FETCH_COMMAND = `bash interface/pull.sh --pinned ${FETCHED.join(' ')}`;

const sha256 = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex');

/**
 * what is wrong with one import's folder against its ORIGIN, in words; empty when it is the pinned copy.
 * With absentOk, a folder that holds none of the export's files (a fetched import nobody fetched) passes;
 * one that holds any of them is checked whole.
 */
export function importProblems(imp: Import, root = ROOT, opts: { absentOk?: boolean } = {}): string[] {
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
  // the folder's own files; a README.md the export itself carries (the framework's) is one of its files
  present.delete('ORIGIN');
  for (const own of ['README.md', 'pull.sh']) if (!recorded.has(own)) present.delete(own);
  if (opts.absentOk && present.size === 0) return out;
  for (const [f, h] of present) {
    if (!recorded.has(f)) out.push(`${imp.into}/${f} is not in ${imp.origin} (a pull lists a file the provider dropped for a person to remove)`);
    else if (recorded.get(f) !== h) out.push(`${imp.into}/${f} differs from ${imp.origin}: take a new copy with interface/pull.sh, never edit one by hand`);
  }
  for (const f of recorded.keys()) if (!present.has(f)) out.push(`${imp.into}/${f} is in ${imp.origin} but not in the folder`);
  return out;
}

/** the export's files are in the folder at all (for a fetched import: somebody fetched them) */
export function fetched(imp: Import, root = ROOT): boolean {
  const folder = join(root, imp.into);
  return existsSync(folder) && readdirSync(folder).some((n) => n !== 'ORIGIN');
}

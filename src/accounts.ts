// The student's own Claude accounts on this computer, as the engine's account switcher (`bee`, in the
// engine repository, src/beethoven_research/bee/) keeps them: <registry>/accounts.json and
// <registry>/usage/<label>.json, and no other file; each must be a plain file, never a link. A list holds
// labels, the folder each account signs in to, on or off, a resting time and the last usage reading the
// account's status line saw; it holds nothing from inside a sign-in folder, and this module never opens,
// lists or checks one, so the view cannot reach a credential. It only reads: bee writes the list, and the
// student runs bee. Every file is opened through readSmall, the one place this module touches the disk.
import { lstatSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const MAX_LIST = 64 * 1024;
const MAX_USAGE = 4 * 1024;
const LABEL_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;
// accounts.json's own fields (bee's RegistryFile and AccountRecord forbid any other)
const RECORD_KEYS = ['label', 'path', 'enabled', 'order', 'hibernate_until'];
// the form bee's utc_text writes, and the offsets Python's fromisoformat also takes in that form
const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|([+-])(\d{2}):(\d{2}))$/;
// bee prints a time only before the year 10000 (utc_text's contract); a later one stops `bee account list`
const MAX_EPOCH = 253402300800;

export interface AccountRow {
  label: string;
  /** the folder the account signs in to; null is Claude Code's default place. Never opened here. */
  path: string | null;
  enabled: boolean;
  order: number;
  /** while the account rests (its window spent, or rested by hand), until when */
  resting_until: string | null;
  five_hour_pct: number | null;
  five_hour_resets: string | null;
  seven_day_pct: number | null;
}

export type AccountList =
  | { ok: true; registry: string; found: boolean; accounts: AccountRow[] }
  /** `beeToo`: bee refuses the same list, so `bee account list` can say what is wrong with it */
  | { ok: false; registry: string; why: string; beeToo: boolean };

/** where bee keeps its account files, by bee's own rule: $BEE_REGISTRY_DIR, else <$BEETHOVEN_HOME or ~/.beethoven>/engine (an empty value counts as unset, untrimmed, as in Python's `or`) */
export function registryDir(env: NodeJS.ProcessEnv, home = homedir()): string {
  return resolve(env.BEE_REGISTRY_DIR || join(env.BEETHOVEN_HOME || join(home, '.beethoven'), 'engine'));
}

/**
 * a small file, whole, or null when it is not there. bee replaces its files whole, so each is a plain file: a link
 * (which could point anywhere, a sign-in folder included) or a file larger than its kind can be is refused unread.
 */
export function readSmall(path: string, max: number): string | null {
  try {
    const st = lstatSync(path);
    if (!st.isFile()) throw new Error('not a plain file');
    if (st.size > max) throw new Error('too large');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw e;
  }
  return readFileSync(path, 'utf8');
}

const utc = (s: number) => new Date(s * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');

/** epoch seconds of a resting time, or null for one bee would not take or could not print; no date is rolled over */
export function epochOf(text: unknown): number | null {
  const m = typeof text === 'string' ? ISO_RE.exec(text) : null;
  if (!m) return null;
  const [y, mo, d, h, mi, sec] = m.slice(1, 7).map(Number) as [number, number, number, number, number, number];
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mo - 1];
  if (y < 1 || days === undefined || d < 1 || d > days || h > 23 || mi > 59 || sec > 59) return null;
  let offset = 0;
  if (m[7]) {
    const [oh, om] = [Number(m[8]), Number(m[9])];
    if (oh > 23 || om > 59) return null;
    offset = (m[7] === '-' ? -1 : 1) * (oh * 3600 + om * 60);
  }
  // setUTCFullYear, because Date.UTC reads a year below 100 as 19xx
  const at = new Date(0);
  at.setUTCFullYear(y, mo - 1, d);
  at.setUTCHours(h, mi, sec, 0);
  const t = at.getTime() / 1000 - offset;
  return t < MAX_EPOCH ? t : null;
}

// bee writes either path family on any system, so neither is asked of this one
function isAbsolute(p: string): boolean {
  return /^[/\\]/.test(p) || /^[A-Za-z]:[\\/]/.test(p);
}

class Unreadable extends Error {}

function record(v: unknown, i: number): { label: string; path: string | null; enabled: boolean; order: number; until: number } {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Unreadable(`entry ${i + 1} is not an account`);
  const r = v as Record<string, unknown>;
  const extra = Object.keys(r).find((k) => !RECORD_KEYS.includes(k));
  if (extra) throw new Unreadable(`entry ${i + 1} has a field bee never writes`);
  if (typeof r.label !== 'string' || !LABEL_RE.test(r.label)) throw new Unreadable(`entry ${i + 1} has no valid label`);
  const label = r.label;
  if (!('path' in r) || (r.path !== null && (typeof r.path !== 'string' || !isAbsolute(r.path)))) throw new Unreadable(`"${label}" has no full folder path`);
  if (r.enabled !== undefined && typeof r.enabled !== 'boolean') throw new Unreadable(`"${label}" is neither on nor off`);
  if (typeof r.order !== 'number' || !Number.isInteger(r.order) || r.order < 0) throw new Unreadable(`"${label}" has no place in the order`);
  let until = 0;
  if (r.hibernate_until !== undefined && r.hibernate_until !== null) {
    const t = epochOf(r.hibernate_until);
    if (t === null) throw new Unreadable(`"${label}" has a resting time that is not a time bee writes`);
    until = t;
  }
  return { label, path: r.path as string | null, enabled: r.enabled !== false, order: r.order, until };
}

/** bee's usage reading: whole percentages and epoch seconds, null where Claude Code sent none; anything else, or a time bee could not print, is no reading */
function usage(text: string | null): { five: number; fiveResets: number; seven: number; sevenResets: number } | null {
  if (text === null) return null;
  try {
    const u = JSON.parse(text) as unknown;
    if (!u || typeof u !== 'object' || Array.isArray(u)) return null;
    const n = (k: string): number => {
      const v = (u as Record<string, unknown>)[k];
      if (v === undefined || v === null) return 0;
      if (typeof v !== 'number' || !Number.isFinite(v) || Math.abs(v) >= MAX_EPOCH) throw new Error(k);
      return Math.trunc(v);
    };
    return { five: n('five_hour_pct'), fiveResets: n('five_hour_resets_at'), seven: n('seven_day_pct'), sevenResets: n('seven_day_resets_at') };
  } catch {
    return null;
  }
}

/**
 * The list as `bee account list --json` gives it, read from bee's files: in their order, a resting time only
 * while it lasts, a usage reading only while its window has not reset. `read` is the one way a file is opened,
 * so a test can see every path asked for.
 */
export function readAccounts(registry: string, nowMs: number, read: (path: string, max: number) => string | null = readSmall): AccountList {
  const now = Math.floor(nowMs / 1000);
  let parsed: unknown;
  try {
    const text = read(join(registry, 'accounts.json'), MAX_LIST);
    if (text === null) return { ok: true, registry, found: false, accounts: [] };
    parsed = JSON.parse(text);
  } catch (e) {
    const m = (e as Error).message;
    if (e instanceof SyntaxError) return { ok: false, registry, why: 'it is not JSON', beeToo: true };
    const why = m === 'too large' ? 'it is larger than an account list can be' : m === 'not a plain file' ? 'it is a link or not a plain file, and Beethoven opens only a plain file there' : 'it could not be opened';
    return { ok: false, registry, why, beeToo: false };
  }
  try {
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Unreadable('it is not an account list');
    const top = parsed as Record<string, unknown>;
    if (Object.keys(top).some((k) => k !== 'version' && k !== 'accounts')) throw new Unreadable('it has a field bee never writes');
    // the value itself is never repeated: the file is text anyone could have written, and the answer goes to the model
    if (top.version !== undefined && top.version !== 1) {
      throw new Unreadable(typeof top.version === 'number' && Number.isInteger(top.version) && top.version > 1 ? 'it is a newer version than this Beethoven reads' : 'its version is not one bee writes');
    }
    if (top.accounts !== undefined && !Array.isArray(top.accounts)) throw new Unreadable('its accounts are not a list');
    const recs = ((top.accounts as unknown[] | undefined) ?? []).map(record);
    if (new Set(recs.map((r) => r.label)).size !== recs.length) throw new Unreadable('a label appears twice');
    if (new Set(recs.map((r) => r.path)).size !== recs.length) throw new Unreadable('one folder is listed under two labels');
    const accounts = recs
      .sort((a, b) => a.order - b.order)
      .map((r): AccountRow => {
        let u: ReturnType<typeof usage> = null;
        try {
          u = usage(read(join(registry, 'usage', `${r.label}.json`), MAX_USAGE));
        } catch {
          // an unreadable reading is no reading, as bee treats it
        }
        const live = u !== null && u.fiveResets > now;
        return {
          label: r.label,
          path: r.path,
          enabled: r.enabled,
          order: r.order,
          resting_until: r.until > now ? utc(r.until) : null,
          five_hour_pct: live ? u!.five : null,
          five_hour_resets: live ? utc(u!.fiveResets) : null,
          seven_day_pct: u !== null && u.sevenResets > now ? u.seven : null,
        };
      });
    return { ok: true, registry, found: true, accounts };
  } catch (e) {
    if (e instanceof Unreadable) return { ok: false, registry, why: e.message, beeToo: true };
    throw e;
  }
}

export function describeAccounts(l: AccountList, asOfMs: number): { text: string; structured: Record<string, unknown>; isError: boolean } {
  const asOf = utc(Math.floor(asOfMs / 1000));
  if (!l.ok) {
    return {
      text: `The list of your Claude accounts on this computer (${join(l.registry, 'accounts.json')}) could not be read: ${l.why}. Beethoven changes nothing in it.${l.beeToo ? ' bee account list, in your own terminal, says what is wrong.' : ''}`,
      structured: { accounts: [], readable: false, registry: l.registry, as_of: asOf },
      isError: true,
    };
  }
  if (l.accounts.length === 0) {
    return {
      // the folder is named: bee may have been told to keep its list elsewhere, which this server is not told
      text: l.found
        ? `The account list in ${join(l.registry, 'accounts.json')} holds no accounts. In your own terminal, bee account add LABEL adds one and signs it in. Beethoven only reads the list.`
        : `No account list was found in ${l.registry}. The account switcher, bee, keeps its list there unless it was set to use another folder, which Beethoven does not read. In your own terminal, bee account list shows the accounts bee sees, and bee account add LABEL adds one and signs it in. Beethoven only reads the list.`,
      structured: { accounts: [], readable: true, registry: l.registry, as_of: asOf },
      isError: false,
    };
  }
  const n = l.accounts.length;
  const lines = [`${n} Claude account${n === 1 ? '' : 's'} on this computer, in their order:`];
  for (const a of l.accounts) {
    const facts = [a.enabled ? 'on' : 'off', a.path === null ? "Claude Code's default sign-in folder" : 'its own sign-in folder'];
    if (a.resting_until) facts.push(`resting until ${a.resting_until}`);
    if (a.five_hour_pct !== null) facts.push(`5-hour window ${a.five_hour_pct}% used, resets ${a.five_hour_resets}`);
    if (a.seven_day_pct !== null) facts.push(`7-day window ${a.seven_day_pct}% used`);
    if (a.five_hour_pct === null && a.seven_day_pct === null) facts.push('no current usage reading');
    lines.push(`- "${a.label}": ${facts.join(', ')}.`);
  }
  lines.push(
    `Read from this computer at ${asOf}. The usage readings are the last ones Claude Code's status line showed for each account here. ` +
      'Beethoven only reads this list; bee account add, enable and disable change it, in your own terminal. ' +
      'worker_list names the Claude account of each grid worker by its e-mail address, which this list does not hold.',
  );
  return { text: lines.join('\n'), structured: { accounts: l.accounts, readable: true, registry: l.registry, as_of: asOf }, isError: false };
}

// src/accounts.ts reads bee's two files by rules typed by hand. beethoven-agents publishes those files as
// JSON Schema (its export `registry`, pinned in registry/ with its ORIGIN), so this holds every name,
// pattern and bound the module types to the schemas, and the module's accept and refuse to what they
// say, the way test/contract.test.ts holds src/contract.ts to hpcworker's contract. What the schemas
// cannot say (distinct labels and paths, an absolute path, the time's form) is bee's prose and is
// tested in test/unit.test.ts.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readAccounts } from '../src/accounts.js';
import { ROOT } from './origin.js';

type Schema = {
  additionalProperties?: boolean;
  required?: string[];
  properties: Record<string, { type?: string | string[]; pattern?: string; const?: unknown; minimum?: number; maximum?: number; $ref?: string }>;
  $defs?: Record<string, Schema>;
};

const read = (f: string) => JSON.parse(readFileSync(join(ROOT, 'registry', f), 'utf8')) as Schema;
const accountsSchema = read('accounts.schema.json');
const usageSchema = read('usage.schema.json');
const record = accountsSchema.$defs!.AccountRecord!;
const src = readFileSync(join(ROOT, 'src', 'accounts.ts'), 'utf8');

// the module's hand-typed constants, read from its source so a change to either side fails here
const LABEL_RE = /^const LABEL_RE = \/(.*)\/;$/m.exec(src)![1]!;
const RECORD_KEYS = /^const RECORD_KEYS = \[(.*)\];$/m.exec(src)![1]!.split(',').map((k) => k.trim().replace(/^'|'$/g, ''));
const USAGE_KEYS = [...src.matchAll(/\bn\('([a-z_]+)'\)/g)].map((m) => m[1]!);

const base = { label: 'a', path: '/x', order: 0 };
const list = (top: Record<string, unknown>) => readAccounts('/r', 0, (p) => (p === join('/r', 'accounts.json') ? JSON.stringify(top) : null));
const accepts = (top: Record<string, unknown>) => list(top).ok;

describe("accounts.json, as beethoven-agents' schema describes it", () => {
  it('the record: the same fields, no other, and the same label pattern', () => {
    expect(record.additionalProperties).toBe(false);
    expect(Object.keys(record.properties).sort()).toEqual([...RECORD_KEYS].sort());
    expect(record.properties.label!.pattern).toBe(LABEL_RE);
    for (const k of RECORD_KEYS) expect(accepts({ accounts: [{ ...base, extra: 1, [k]: base[k as keyof typeof base] }] }), `an unknown field beside ${k}`).toBe(false);
  });

  it('the fields the schema requires are the ones the module refuses to go without; the rest may be absent', () => {
    const required = new Set(record.required);
    expect(required.size).toBeGreaterThan(0);
    for (const k of Object.keys(record.properties)) {
      const without: Record<string, unknown> = { ...base, enabled: true, hibernate_until: null };
      delete without[k];
      expect(accepts({ accounts: [without] }), k).toBe(!required.has(k));
    }
    // the minimal record the schema allows, and the fullest, both read
    expect(accepts({ accounts: [base] })).toBe(true);
    expect(accepts({ version: 1, accounts: [{ ...base, enabled: false, hibernate_until: '2026-10-04T09:00:00Z' }] })).toBe(true);
  });

  it("the file: version 1 and accounts, nothing else", () => {
    expect(accountsSchema.additionalProperties).toBe(false);
    expect(Object.keys(accountsSchema.properties).sort()).toEqual(['accounts', 'version']);
    expect(accountsSchema.properties.version!.const).toBe(1);
    expect(accepts({ version: 1, accounts: [] })).toBe(true);
    expect(accepts({ version: 2, accounts: [] })).toBe(false);
    expect(accepts({ accounts: [], note: 'x' })).toBe(false);
  });

  it('order is a whole number from 0, as the schema bounds it', () => {
    expect(record.properties.order).toMatchObject({ type: 'integer', minimum: 0 });
    for (const order of [-1, 0.5, '1']) expect(accepts({ accounts: [{ ...base, order }] }), String(order)).toBe(false);
  });

  it('path is a string or null; enabled a boolean', () => {
    expect(record.properties.path).toMatchObject({ anyOf: [{ type: 'string' }, { type: 'null' }] });
    expect(record.properties.enabled!.type).toBe('boolean');
    expect(accepts({ accounts: [{ ...base, path: null }] })).toBe(true);
    expect(accepts({ accounts: [{ ...base, path: 7 }] })).toBe(false);
    expect(accepts({ accounts: [{ ...base, enabled: 'yes' }] })).toBe(false);
  });
});

describe("usage/<label>.json, as beethoven-agents' schema describes it", () => {
  it('every field the module reads is one the schema lists, with the type the module expects', () => {
    expect(usageSchema.additionalProperties).toBe(false);
    expect(USAGE_KEYS.length).toBe(4);
    for (const k of USAGE_KEYS) expect(Object.keys(usageSchema.properties), k).toContain(k);
    // whole percentages from 0 to 100, or null; reset times whole seconds, never null (0 when none)
    for (const k of USAGE_KEYS.filter((k) => k.endsWith('_pct'))) expect(usageSchema.properties[k], k).toMatchObject({ type: ['integer', 'null'], minimum: 0, maximum: 100 });
    for (const k of USAGE_KEYS.filter((k) => k.endsWith('_resets_at'))) expect(usageSchema.properties[k], k).toMatchObject({ type: 'integer' });
    // what the schema lists and the module leaves alone: the account's own name and the session that wrote it
    expect(Object.keys(usageSchema.properties).filter((k) => !USAGE_KEYS.includes(k)).sort()).toEqual(['label', 'session_id']);
  });

  it('a reading in the schema’s shape is shown; one outside it is no reading', () => {
    const now = 1_700_000_000_000;
    const files = (usage: unknown) => (p: string) =>
      p === join('/r', 'accounts.json') ? JSON.stringify({ accounts: [base] }) : p === join('/r', 'usage', 'a.json') ? JSON.stringify(usage) : null;
    const full = { label: 'a', session_id: 's', five_hour_pct: 42, five_hour_resets_at: now / 1000 + 60, seven_day_pct: 18, seven_day_resets_at: now / 1000 + 600 };
    let l = readAccounts('/r', now, files(full));
    expect(l.ok && l.accounts[0]).toMatchObject({ five_hour_pct: 42, seven_day_pct: 18 });
    l = readAccounts('/r', now, files({ ...full, five_hour_pct: '42' }));
    expect(l.ok && l.accounts[0]).toMatchObject({ five_hour_pct: null, seven_day_pct: null });
  });
});

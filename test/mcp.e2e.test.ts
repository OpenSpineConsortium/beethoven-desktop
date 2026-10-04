// The built server as Claude Desktop and Claude Code start it: a separate node process speaking MCP on
// stdio, driven by the official TypeScript SDK's client, against the lab's sshd. The server is compiled
// to a temporary folder laid out like the bundle (server/, profiles/), with the lab's profile beside it.
// The student's settings reach it as the environment variables both manifests set.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { labMissing, startLab, type Lab } from './lab.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TOOL_NAMES = ['grid_sign_in', 'grid_sign_out', 'grid_check', 'worker_status', 'worker_list', 'worker_start', 'worker_stop', 'worker_log', 'workspace_list', 'workspace_read', 'account_list', 'open_in_claude'];

let built = '';
function build(): string {
  if (built) return built;
  const d = mkdtempSync(join(tmpdir(), 'bd-build-'));
  const r = spawnSync(process.execPath, [join(ROOT, 'node_modules/typescript/bin/tsc'), '-p', join(ROOT, 'tsconfig.build.json'), '--outDir', join(d, 'server')], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`tsc: ${r.stdout}${r.stderr}`);
  writeFileSync(join(d, 'server', 'package.json'), '{"type":"module"}\n');
  mkdirSync(join(d, 'profiles'));
  copyFileSync(join(ROOT, 'profiles', 'wayne.json'), join(d, 'profiles', 'wayne.json'));
  built = d;
  return d;
}

type Text = { content: Array<{ type: string; text?: string }>; isError?: boolean; structuredContent?: Record<string, unknown> };
const textOf = (r: unknown) => (r as Text).content.map((c) => c.text ?? '').join('\n');

async function connect(env: Record<string, string>): Promise<{ client: Client; stderr: () => string }> {
  const t = new StdioClientTransport({ command: process.execPath, args: [join(build(), 'server', 'index.js')], env, stderr: 'pipe' });
  let err = '';
  t.stderr?.on('data', (b: Buffer) => (err += b.toString('utf8')));
  const client = new Client({ name: 'beethoven-desktop-test', version: '1.0.0' });
  await client.connect(t);
  return { client, stderr: () => err };
}

afterAll(() => {
  if (built) rmSync(built, { recursive: true, force: true });
});

describe('the built server, through the MCP SDK client', () => {
  it('lists the twelve tools with honest hints, and asks for the account before anything else', async () => {
    const { client, stderr } = await connect({ PATH: process.env.PATH ?? '', HOME: mkdtempSync(join(tmpdir(), 'bd-home-')), BEETHOVEN_DESKTOP_ACCOUNT: '${user_config.grid_account}' });
    try {
      expect(client.getServerVersion()).toMatchObject({ name: 'beethoven-desktop', version: '1.0.0' });
      expect(client.getInstructions()).toMatch(/never ask the student for a password/);
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name).sort()).toEqual([...TOOL_NAMES].sort());
      const by = Object.fromEntries(tools.map((t) => [t.name, t]));
      expect(by['worker_stop']!.annotations).toMatchObject({ destructiveHint: true });
      expect(by['account_list']!.annotations).toMatchObject({ readOnlyHint: true, openWorldHint: false });
      for (const n of ['grid_check', 'worker_status', 'worker_list', 'worker_log', 'workspace_list', 'workspace_read', 'account_list']) expect(by[n]!.annotations?.readOnlyHint, n).toBe(true);
      // no tool takes anything that could be a secret
      for (const t of tools) for (const k of Object.keys((t.inputSchema.properties ?? {}) as object)) expect(k).toMatch(/^(?:name|path|max_bytes|lines|permission_mode|keep_running)$/);
      const r = await client.callTool({ name: 'grid_check', arguments: {} });
      expect(r.isError).toBe(true);
      expect(textOf(r)).toMatch(/doesn't know your grid account name/);
      const bad = await client.callTool({ name: 'worker_status', arguments: { name: 'x; id' } });
      expect(bad.isError).toBe(true);
      expect(stderr()).toBe('beethoven-desktop 1.0.0 started\n');
    } finally {
      await client.close();
    }
  }, 60_000);

  it('account_list reads the list bee keeps in the home folder, with no grid in reach', async () => {
    const home = mkdtempSync(join(tmpdir(), 'bd-home-'));
    mkdirSync(join(home, '.beethoven', 'engine'), { recursive: true });
    writeFileSync(join(home, '.beethoven', 'engine', 'accounts.json'), JSON.stringify({ version: 1, accounts: [{ label: 'main', path: null, enabled: true, order: 0, hibernate_until: null }, { label: 'work', path: join(home, 'w'), enabled: false, order: 1 }] }));
    // no lab sshd is running for this test, and the list needs none. Windows finds the home in USERPROFILE.
    const { client } = await connect({ PATH: process.env.PATH ?? '', HOME: home, USERPROFILE: home, BEETHOVEN_DESKTOP_ACCOUNT: 'ab1234' });
    try {
      const r = await client.callTool({ name: 'account_list', arguments: {} });
      expect(r.isError).toBeFalsy();
      expect(textOf(r)).toContain('2 Claude accounts on this computer, in their order:');
      expect(textOf(r)).toContain('- "work": off, its own sign-in folder, no current usage reading.');
      expect((r as Text).structuredContent).toMatchObject({ readable: true, registry: join(home, '.beethoven', 'engine'), accounts: [{ label: 'main' }, { label: 'work', enabled: false }] });
      const bad = await client.callTool({ name: 'account_list', arguments: { label: 'main' } });
      expect(bad.isError).toBe(true);
    } finally {
      await client.close();
      rmSync(home, { recursive: true, force: true });
    }
  }, 60_000);

  it('a site with no profile still starts, and says why', async () => {
    const { client } = await connect({ PATH: process.env.PATH ?? '', HOME: tmpdir(), BEETHOVEN_DESKTOP_SITE: 'nowhere', BEETHOVEN_DESKTOP_ACCOUNT: 'ab1234' });
    try {
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name)).toEqual(['grid_check', 'account_list']);
      const r = await client.callTool({ name: 'grid_check', arguments: {} });
      expect(r.isError).toBe(true);
      expect(textOf(r)).toMatch(/can't reach a grid/);
      // the account list on this computer needs no grid, so a grid setting that is wrong does not hide it
      const a = await client.callTool({ name: 'account_list', arguments: {} });
      expect(textOf(a)).not.toMatch(/can't reach a grid/);
      expect((a as Text).structuredContent).toHaveProperty('accounts');
    } finally {
      await client.close();
    }
  }, 60_000);
});

describe.skipIf(labMissing())('the built server against the lab sshd', () => {
  let lab: Lab;
  let client: Client;

  beforeAll(async () => {
    lab = await startLab({});
    copyFileSync(join(lab.profiles, `${lab.site}.json`), join(build(), 'profiles', `${lab.site}.json`));
    ({ client } = await connect({
      // the lab's fake terminal first on PATH; the rest for script, sleep and the shells
      PATH: `${lab.fakeTerm}:${process.env.PATH ?? ''}`,
      HOME: lab.localHome,
      BEETHOVEN_DESKTOP_SITE: lab.site,
      BEETHOVEN_DESKTOP_ACCOUNT: lab.account,
      BEETHOVEN_DESKTOP_WORKER: 'worker',
      BEETHOVEN_DESKTOP_USE_WSL: 'false',
      BEETHOVEN_DESKTOP_SSH: lab.ssh,
    }));
  }, 90_000);
  afterAll(async () => {
    await client?.close();
    lab?.stop();
  });

  const call = (name: string, args: Record<string, unknown> = {}) => client.callTool({ name, arguments: args }, undefined, { timeout: 120_000 });

  it('grid_check before the sign-in says to sign in', async () => {
    const r = await call('grid_check');
    expect(r.isError).toBe(true);
    expect(textOf(r)).toMatch(/not signed in to the grid/);
  });

  it('grid_sign_in opens the terminal and comes back signed in', async () => {
    const r = await call('grid_sign_in');
    expect(r.isError).toBeFalsy();
    expect(textOf(r)).toMatch(/^Signed in to the test grid\./);
    expect((r as Text).structuredContent).toEqual({ signed_in: true });
  }, 120_000);

  it('grid_check, worker_start, worker_status, workspace_read, worker_log', async () => {
    const c = await call('grid_check');
    expect(textOf(c)).toContain(`Grid account: ${lab.account}.`);
    const s = await call('worker_start', { keep_running: false });
    expect(s.isError).toBeFalsy();
    writeFileSync(join(lab.state, 'workspaces', 'worker', 'CLAUDE.md'), '# rules\nkey sk-ant-api03-' + 'y'.repeat(80) + '\n');
    writeFileSync(join(lab.state, 'worker', 'status.json'), JSON.stringify({ state: 'online', node: 'asx15', environment_url: 'https://claude.ai/code?environment=env_01E2E' }));
    const st = await call('worker_status');
    expect(textOf(st)).toMatch(/online/i);
    expect(textOf(st)).toContain('https://claude.ai/code?environment=env_01E2E');
    const f = await call('workspace_read', { path: 'CLAUDE.md' });
    expect(textOf(f)).toContain('# rules');
    expect(textOf(f)).not.toContain('sk-ant-api03-yyyy');
    const ls = await call('workspace_list');
    expect(textOf(ls)).toMatch(/CLAUDE\.md/);
    const log = await call('worker_log', { lines: 5 });
    expect(textOf(log)).toMatch(/Asked the grid for a computer/);
  }, 120_000);

  it('a second press within the minute is refused by the server, not sent', async () => {
    const r = await call('worker_stop');
    expect(r.isError).toBe(true);
    expect(textOf(r)).toMatch(/less than a minute ago/);
  });

  it('grid_sign_out ends the kept sign-in', async () => {
    const r = await call('grid_sign_out');
    expect((r as Text).structuredContent).toEqual({ was_signed_in: true });
    const c = await call('grid_check');
    expect(textOf(c)).toMatch(/not signed in/);
  });
});

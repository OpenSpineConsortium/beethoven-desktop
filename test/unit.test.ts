// The pieces that need no grid: the contract's lines and parsers, the redactors, the workspace's path
// rules, the pinned host key, the launcher and the openers, the settings, and the protocol itself.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { configFrom } from '../src/config.js';
import {
  gateCommand, gateRefusal, gateRemoteLine, isClaudeCodeLink, linkOf, parseGateVersion, parseStatusJson, parseStepLine, progressLines, stoppedLine, type StatusJson,
} from '../src/contract.js';
import { McpServer, SUPPORTED_VERSIONS, type Tool } from '../src/mcp.js';
import { loadProfile, profileFrom, ProfileError, stateDirFor } from '../src/profile.js';
import { redact, redactCredentials } from '../src/redact.js';
import { callArgv, childEnv, classify, controlArgv, fingerprintOf, hostPattern, pinnedLines, routeFor, sftpArgv, signInArgv, wslPath } from '../src/ssh.js';
import { cmdQuote, launcherText, openerArgv, shQuote, terminalArgv } from '../src/terminal.js';
import { describeStatus } from '../src/tools.js';
import { refusedName, segmentsOf } from '../src/workspace.js';
import { PRODUCT_NAME, TRADEMARK, VERSION } from '../src/version.js';

const wayne = loadProfile('wayne');
const T = { host: 'grid.wayne.edu', port: 22, account: 'ab1234' };

describe('the gate lines', () => {
  it('builds exactly the verbs this edition sends, and nothing from a bad value', () => {
    expect(gateCommand({ verb: 'version' })).toBe('version');
    expect(gateCommand({ verb: 'status', name: 'worker' })).toBe('status worker');
    expect(gateCommand({ verb: 'connect', name: 'worker', site: 'wayne', mode: 'default', chain: true })).toBe('connect worker wayne - default chain');
    expect(gateCommand({ verb: 'connect', name: 'gpu', site: 'wayne', mode: 'plan', chain: false })).toBe('connect gpu wayne - plan no-chain');
    expect(gateCommand({ verb: 'read', name: 'worker', file: 'progress.log' })).toBe('read worker progress.log');
    for (const bad of ['-x', '_x', 'a b', 'a;id', '$(id)', '', 'x'.repeat(33)]) expect(() => gateCommand({ verb: 'status', name: bad })).toThrow();
    expect(() => gateCommand({ verb: 'read', name: 'worker', file: 'rc.log' as 'node' })).toThrow();
    expect(() => gateCommand({ verb: 'connect', name: 'w', site: 'Wayne', mode: 'default', chain: true })).toThrow();
    expect(() => gateCommand({ verb: 'connect', name: 'w', site: 'wayne', mode: 'bypassPermissions' as 'plan', chain: true })).toThrow();
  });

  it('runs the lab copy\'s gate with the line in SSH_ORIGINAL_COMMAND, quoted, from a plain path only', () => {
    expect(gateRemoteLine(wayne.sharedInstall, { verb: 'status', name: 'worker' })).toBe(
      "env SSH_ORIGINAL_COMMAND='status worker' bash '/rs/rs_grp_oschome/shared/beethoven/hpcworker/current/bin/hpcworker' gate",
    );
    for (const bad of ['relative/x', "/a'b", '/a b', '/a/../b', '/a;id']) expect(() => gateRemoteLine(bad, { verb: 'version' })).toThrow();
  });

  it('reads the gate\'s lines by their prefix, whatever a ~/.bashrc printed first', () => {
    expect(parseGateVersion('hello from bashrc\nHPCW-GATE ok 16 never ab1234 claude=yes\n')).toEqual({ framework: '16', account: 'ab1234', claude: 'yes' });
    expect(parseGateVersion('HPCW-GATE ok 16 never')).toBeNull();
    expect(gateRefusal('hi\nHPCW-GATE refused\n')).toBe('refused');
    expect(gateRefusal('HPCW-GATE limit names\n')).toBe('limit names');
    expect(gateRefusal('HPCW-KEY expired\n')).toBe('expired');
    expect(gateRefusal('{"v":1,"run":"worker"}')).toBeNull();
    const s = parseStatusJson('bashrc\n{"v":1,"run":"worker","job":"1","next_job":"","state_dir":"/s","status":{"state":"online","environment_url":"https://claude.ai/code?environment=env_01X"},"connection":null,"scheduler":null,"line":"Your worker is online."}\n');
    expect(s?.status?.state).toBe('online');
    expect(linkOf(s!)).toBe('https://claude.ai/code?environment=env_01X');
    expect(parseStatusJson('{"v":2,"run":"x"}')).toBeNull();
    expect(stoppedLine('x\nworker worker: stopped (request; the chain ended)\n')).toBe('worker worker: stopped (request; the chain ended)');
  });

  it('parses HPCW-STEP as V11 §5.3 writes it', () => {
    expect(parseStepLine('HPCW-STEP setup ready')).toEqual({ kind: 'setup', changed: false });
    expect(parseStepLine('HPCW-STEP queued 40501234 new /rs/x/hpcworker/worker')).toEqual({ kind: 'queued', job: '40501234', kept: false, runDir: '/rs/x/hpcworker/worker' });
    expect(parseStepLine('HPCW-STEP failed weird something')).toEqual({ kind: 'failed', code: 'other', sentence: 'something' });
    expect(parseStepLine('HPCW-STEP failed restricted')).toEqual({ kind: 'failed', code: 'restricted', sentence: '' });
    expect(parseStepLine(' HPCW-STEP done')).toBeNull();
    expect(progressLines('bashrc\n2026-10-04T01:00:00Z Asked the grid for a computer\nnope\n')).toEqual(['2026-10-04T01:00:00Z Asked the grid for a computer']);
  });

  it('opens only a Claude Code link, exactly', () => {
    expect(isClaudeCodeLink('https://claude.ai/code?environment=env_01XzAN32jsbL8W1PAFSvitBt')).toBe(true);
    expect(isClaudeCodeLink('https://claude.ai/code/session_01TestResumedSession000000')).toBe(true);
    for (const bad of ['https://claude.ai/code?environment=env_x&y=1', 'https://evil.example/code?environment=env_1', ' https://claude.ai/code?environment=env_1', 'javascript:alert(1)']) {
      expect(isClaudeCodeLink(bad)).toBe(false);
      expect(() => openerArgv('linux', bad)).toThrow();
    }
    expect(openerArgv('darwin', 'https://claude.ai/code?environment=env_1')).toEqual(['open', 'https://claude.ai/code?environment=env_1']);
    expect(openerArgv('win32', 'https://claude.ai/code?environment=env_1')).toEqual(['rundll32.exe', 'url.dll,FileProtocolHandler', 'https://claude.ai/code?environment=env_1']);
  });
});

describe('redaction', () => {
  it('the browser edition\'s rules, for everything but workspace files', () => {
    expect(redact('token=abc123 password: hunter2')).toBe('token=[redacted] password: [redacted]');
    expect(redact('sk-ant-oat01-AAAA_bbbb')).toBe('[redacted]');
    expect(redact('x'.repeat(40))).toBe('[redacted]');
    expect(redact('https://claude.ai/code?environment=env_01XzAN32jsbL8W1PAFSvitBt')).toBe('https://claude.ai/code?environment=env_01XzAN32jsbL8W1PAFSvitBt');
  });

  it('a workspace file keeps commit ids and loses what has a credential\'s shape', () => {
    const sha = 'a'.repeat(40);
    const creds = '{"claudeAiOauth":{"accessToken":"sk-ant-oat01-SECRET","refreshToken":"sk-ant-ort01-SECRET2","expiresAt":1}}';
    const out = redactCredentials(`commit ${sha}\n${creds}\nAuthorization: Bearer abcdefghijkl\nANTHROPIC_API_KEY=xyz\n-----BEGIN OPENSSH PRIVATE KEY-----\nAAAA\n-----END OPENSSH PRIVATE KEY-----\n`);
    expect(out).toContain(sha);
    expect(out).not.toMatch(/SECRET|abcdefghijkl|xyz|AAAA/);
    expect(out).toContain('[private key redacted]');
  });
});

describe('the workspace\'s path rules', () => {
  it('takes plain relative segments only', () => {
    expect(segmentsOf('')).toEqual([]);
    expect(segmentsOf('src/train.py')).toEqual(['src', 'train.py']);
    expect(segmentsOf('a\\b//c/')).toEqual(['a', 'b', 'c']);
    for (const bad of ['/etc/passwd', '../x', 'a/../../b', 'a/./b', 'a\u0000b', 'a\nb']) expect(() => segmentsOf(bad)).toThrow();
  });

  it('refuses credential names wherever they are', () => {
    for (const n of ['.credentials.json', '.CLAUDE.json', 'job.token', 'x.token', '.env', '.env.local', 'id_ed25519', 'id_rsa', 'server.key', 'cert.pem', '.netrc']) expect(refusedName(n)).toBe(true);
    for (const n of ['CLAUDE.md', 'credentials.md', 'env.py', 'id_rsa.pub', 'token.py', 'keys.txt']) expect(refusedName(n)).toBe(false);
  });
});

describe('ssh', () => {
  it('pins the host key: only the profile\'s fingerprint is written, for our host pattern', () => {
    const b64 = 'AAAAC3NzaC1lZDI1NTE5AAAAIBCj/iayuSj3Fidk+gybZFVkRGUgZuPSuVKeM+iqcGM2';
    const fp = fingerprintOf(b64);
    expect(fp).toMatch(/^SHA256:[A-Za-z0-9+/]{43}$/);
    const scan = `# grid.wayne.edu:22 SSH-2.0-OpenSSH_7.4\ngrid.wayne.edu ssh-ed25519 ${b64}\ngrid.wayne.edu ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAAAgQC\n`;
    expect(pinnedLines(scan, fp, T)).toEqual({ lines: [`grid.wayne.edu ssh-ed25519 ${b64}`], seen: [`ssh-ed25519 ${fp}`, expect.stringMatching(/^ssh-rsa SHA256:/)] });
    expect(pinnedLines(scan, wayne.sshHostKey, T).lines).toEqual([]);
    expect(hostPattern({ host: '127.0.0.1', port: 2222 })).toBe('[127.0.0.1]:2222');
  });

  it('every call: the pinned file alone, no forwarding, never a prompt, the kept sign-in', () => {
    const r = routeFor({ useWsl: false, sshPath: '' }, 'darwin', '/Users/a b');
    const a = callArgv(r, T, 'X');
    const opts = a.filter((_, i) => a[i - 1] === '-o');
    expect(opts).toEqual(expect.arrayContaining([
      'UserKnownHostsFile=/Users/a b/.beethoven-desktop/known_hosts', 'StrictHostKeyChecking=yes', 'BatchMode=yes', 'ForwardAgent=no', 'ClearAllForwardings=yes',
      'ControlMaster=no', 'ControlPath=/Users/a b/.beethoven-desktop/cm-%C',
    ]));
    expect(a.slice(-2)).toEqual(['grid.wayne.edu', 'X']);
    expect(a).toContain('-T');
    expect(signInArgv(r, T)).toEqual(expect.arrayContaining(['ControlMaster=auto', 'ControlPersist=4h']));
    expect(signInArgv(r, T)).not.toContain('BatchMode=yes');
    expect(sftpArgv(r, T).slice(-3)).toEqual(['-s', 'grid.wayne.edu', 'sftp']);
    expect(controlArgv(r, T, 'check')).toEqual(['ssh', '-o', 'ControlPath=/Users/a b/.beethoven-desktop/cm-%C', '-O', 'check', '-p', '22', '-l', 'ab1234', 'grid.wayne.edu']);
  });

  it('Windows: its own ssh keeps no sign-in; WSL\'s does, with the socket in WSL\'s home', () => {
    const w = routeFor({ useWsl: false, sshPath: '' }, 'win32', 'C:\\Users\\ab', { SystemRoot: 'C:\\nowhere' });
    expect(w.mux).toBe(false);
    expect(callArgv(w, T, 'X').join(' ')).not.toContain('ControlPath');
    const l = routeFor({ useWsl: true, sshPath: '' }, 'win32', 'C:\\Users\\ab');
    expect(l.ssh).toEqual(['wsl.exe', '-e', 'ssh']);
    expect(l.controlPath).toBe('~/.beethoven-desktop/cm-%C');
    expect(l.knownHosts).toBe('/mnt/c/Users/ab/.beethoven-desktop/known_hosts');
    expect(wslPath('D:\\x\\y')).toBe('/mnt/d/x/y');
  });

  it('tells its own failures from the command\'s', () => {
    const r = (code: number | null, stderr: string, x: Partial<{ missing: boolean; timedOut: boolean }> = {}) => ({ code, stdout: '', stderr, timedOut: false, missing: false, ...x });
    expect(classify(r(255, 'ab1234@grid.wayne.edu: Permission denied (publickey,password,keyboard-interactive).'))).toBe('not-signed-in');
    expect(classify(r(255, 'Host key verification failed.'))).toBe('hostkey');
    expect(classify(r(255, 'ssh: Could not resolve hostname grid.wayne.edu'))).toBe('unreachable');
    expect(classify(r(1, 'Permission denied'))).toBeNull();
    expect(classify(r(null, '', { missing: true }))).toBe('not-installed');
  });

  it('hands no credential-named variable to a child', () => {
    const env = childEnv({ PATH: '/bin', ANTHROPIC_API_KEY: 'x', CLAUDE_CODE_OAUTH_TOKEN: 'x', CLAUDECODE: '1', GITHUB_TOKEN: 'x', SSH_AUTH_SOCK: '/s', HOME: '/h' });
    expect(Object.keys(env).sort()).toEqual(['HOME', 'PATH', 'SSH_AUTH_SOCK']);
  });
});

describe('the sign-in launcher', () => {
  it('sh: every word single-quoted, three plain sentences, exec ssh', () => {
    const r = routeFor({ useWsl: false, sshPath: '' }, 'darwin', "/Users/o'neil");
    const text = launcherText('darwin', signInArgv(r, T), ['Line one.', "It's two."]);
    expect(text.startsWith('#!/bin/sh\n')).toBe(true);
    expect(text).toContain(`'UserKnownHostsFile=/Users/o'\\''neil/.beethoven-desktop/known_hosts'`);
    expect(text).toMatch(/\nexec 'ssh' /);
    expect(shQuote("a'b")).toBe(`'a'\\''b'`);
    if (process.platform !== 'win32') expect(spawnSync('sh', ['-n'], { input: text }).status).toBe(0);
  });

  it('cmd: every word double-quoted, % doubled, echo lines escaped', () => {
    const r = routeFor({ useWsl: true, sshPath: '' }, 'win32', 'C:\\Users\\Jane Doe');
    const text = launcherText('win32', signInArgv(r, T), ['Beethoven: (a) & b.']);
    expect(text).toContain('"ControlPath=~/.beethoven-desktop/cm-%%C"');
    expect(text).toContain('echo Beethoven: ^(a^) ^& b.');
    expect(text.split('\r\n')[0]).toBe('@echo off');
    expect(() => cmdQuote('a"b')).toThrow();
  });

  it('opens the launcher in the system\'s terminal app', () => {
    expect(terminalArgv('darwin', '/x/sign-in.command')).toEqual(['open', '-a', 'Terminal', '/x/sign-in.command']);
    expect(terminalArgv('win32', 'C:\\x y\\sign-in.cmd')).toEqual(['cmd.exe', '/d', '/c', 'start "Beethoven" "C:\\x y\\sign-in.cmd"']);
    expect(terminalArgv('win32', 'C:\\100%\\sign-in.cmd')).toBeNull();
    expect(terminalArgv('linux', '/x/sign-in.sh', { PATH: '/nonexistent' })).toBeNull();
  });
});

describe('settings and profiles', () => {
  it('reads the settings; an unset optional arrives empty or as its placeholder', () => {
    const { config, problems } = configFrom({ BEETHOVEN_DESKTOP_ACCOUNT: 'AB1234', BEETHOVEN_DESKTOP_WORKER: '${user_config.worker_name}', BEETHOVEN_DESKTOP_USE_WSL: 'true' });
    expect(config).toEqual({ site: 'wayne', account: 'ab1234', worker: 'worker', useWsl: true, sshPath: '' });
    expect(problems).toEqual([]);
    expect(configFrom({ BEETHOVEN_DESKTOP_ACCOUNT: '-oProxyCommand=x' }).config.account).toBe('');
    expect(configFrom({ BEETHOVEN_DESKTOP_ACCOUNT: '-oProxyCommand=x' }).problems.length).toBe(1);
  });

  it('reads Wayne State\'s profile and refuses one that is not plain', () => {
    expect(wayne).toMatchObject({ sshHost: 'grid.wayne.edu', sshPort: 22, sshHostKey: 'SHA256:kLTz1xK6anQ1denM+31kDEryQtgan2P76r9aLno+K3s', vpnRequired: true, vpnApp: 'GlobalProtect' });
    expect(stateDirFor(wayne, 'ab1234')).toBe('/rs/rs_grp_oschome/ab1234/hpcworker');
    const raw = JSON.parse(readFileSync(new URL('../profiles/wayne.json', import.meta.url), 'utf8')) as Record<string, unknown>;
    expect(() => profileFrom({ ...raw, ssh_host: '-oProxyCommand=x' }, 'wayne')).toThrow(ProfileError);
    expect(() => profileFrom({ ...raw, shared_install: '/rs/$USER/x' }, 'wayne')).toThrow(ProfileError);
    expect(() => profileFrom({ ...raw, ssh_host_key: 'MD5:aa' }, 'wayne')).toThrow(ProfileError);
    expect(() => loadProfile('../etc')).toThrow(ProfileError);
  });
});

describe('words', () => {
  it('names the product once, with the trademark sentence verbatim', () => {
    expect(PRODUCT_NAME).toBe('Beethoven');
    expect(TRADEMARK).toBe('Beethoven runs Claude Code and is not an Anthropic product; "Claude" and "Claude Code" are Anthropic\'s marks, used here to say what it runs; "Open OnDemand" is the mark of its publisher.');
    const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
    const manifest = JSON.parse(readFileSync(new URL('../bundle/manifest.json', import.meta.url), 'utf8')) as { version: string; long_description: string; display_name: string };
    expect(readme).toContain(TRADEMARK);
    expect(manifest.long_description).toContain(TRADEMARK);
    expect(manifest.display_name).toBe('Beethoven');
    expect(manifest.version).toBe(VERSION);
  });

  it('a worker that waits for a Claude sign-in gets the line the student runs, never one Beethoven runs', () => {
    const s: StatusJson = { v: 1, run: 'worker', job: '1', next_job: '', state_dir: '/s', status: { state: 'need_login' }, connection: null, scheduler: null, line: 'Your worker is waiting for your Claude sign-in.' };
    const d = describeStatus(s, 0, 60_000, false, 'Wayne State grid', wayne.sharedInstall);
    expect(d.text).toContain(`bash ${wayne.sharedInstall}/bin/hpcworker claude login`);
    expect(d.text).toContain('Beethoven never runs it');
  });
});

describe('MCP over stdio, in process', () => {
  const tool: Tool = {
    name: 'echo', title: 'Echo', description: 'echo', inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true }, call: async (a) => ({ content: [{ type: 'text', text: JSON.stringify(a) }] }),
  };
  const talk = async (lines: string[]) => {
    const out: string[] = [];
    const s = new McpServer({ name: 'n', title: 'T', version: '1.0.0', instructions: 'i' }, [tool], (l) => out.push(l));
    for (const l of lines) await s.handleLine(l);
    return out.map((l) => JSON.parse(l) as Record<string, any>);
  };

  it('initialize answers the asked version when it knows it, else its newest', async () => {
    const [a, b] = await talk([
      JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'c', version: '1' } } }),
      JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '2099-01-01' } }),
    ]);
    expect(a!.result.protocolVersion).toBe('2025-06-18');
    expect(a!.result.capabilities).toEqual({ tools: { listChanged: false } });
    expect(b!.result.protocolVersion).toBe(SUPPORTED_VERSIONS[0]);
  });

  it('answers requests, ignores notifications, and reports errors as JSON-RPC does', async () => {
    const out = await talk([
      '{"jsonrpc":"2.0","method":"notifications/initialized"}',
      '{"jsonrpc":"2.0","id":3,"method":"tools/list"}',
      '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"echo","arguments":{"a":1}}}',
      '{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"nope"}}',
      '{"jsonrpc":"2.0","id":6,"method":"resources/list"}',
      'not json',
      '{"jsonrpc":"2.0","id":7,"method":"ping"}',
    ]);
    expect(out.map((o) => o.id)).toEqual([3, 4, 5, 6, null, 7]);
    expect(out[0]!.result.tools[0]).toMatchObject({ name: 'echo', annotations: { title: 'Echo', readOnlyHint: true } });
    expect(out[1]!.result.content[0].text).toBe('{"a":1}');
    expect(out[2]!.error.code).toBe(-32602);
    expect(out[3]!.error.code).toBe(-32601);
    expect(out[4]!.error.code).toBe(-32700);
    expect(out[5]!.result).toEqual({});
  });
});

describe('the posture check', () => {
  it('finds the source clean', () => {
    const r = spawnSync(process.execPath, ['scripts/forbidden.mjs', 'src'], { encoding: 'utf8' });
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
  });
});

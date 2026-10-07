// A grid of our own for the ssh tests: OpenSSH's sshd run by this account on 127.0.0.1 with the grid's
// algorithms (an RSA host key, aes-ctr, hmac-sha1), the sessions' HOME a test folder (sshd's SetEnv), and
// the lab's shared copy of hpcworker at <lab>/shared/current: either the gate stand-in of this folder, or
// hpcworker's `framework` export behind its `testbed` (the fake scheduler), both pinned in this repository
// with ORIGIN, fetched by interface/pull.sh, and checked against ORIGIN before either runs. Nothing here
// reaches a real grid; every file is under one temporary folder, removed at the end. The ssh our server
// runs is a wrapper that reads only the lab's own ssh config: a key that is NOT authorized, so a call
// without the kept sign-in is refused, as a password account's would be; the sign-in itself (the
// "terminal") uses the authorized session key.
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fingerprintOf } from '../src/ssh.js';
import { FETCH_COMMAND, FETCHED, fetched, importOf, importProblems } from './origin.js';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const ROOT = join(HERE, '..');
const [TESTBED, FRAMEWORK] = FETCHED.map((f) => importOf(f)) as [ReturnType<typeof importOf>, ReturnType<typeof importOf>];

function which(name: string): string | null {
  const r = spawnSync('sh', ['-c', `command -v ${name}`], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
}

function findSshd(): string | null {
  for (const p of [process.env.SSHD, '/usr/sbin/sshd', '/usr/local/sbin/sshd']) if (p && existsSync(p)) return p;
  return which('sshd');
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const a = s.address();
      s.close(() => resolve(typeof a === 'object' && a ? a.port : 0));
    });
  });
}

export interface Lab {
  dir: string;
  port: number;
  account: string;
  fingerprint: string;
  site: string;
  profiles: string;
  profileRaw: Record<string, unknown>;
  ssh: string;
  localHome: string;
  state: string;
  home: string;
  fakeTerm: string;
  gate: 'standin' | 'real';
  sshdLog: string;
  stop: () => void;
}

/** why the lab cannot run here, or null when it can; with BD_REQUIRE_LAB set (CI), a reason is a failure */
export function labMissing(): string | null {
  const why = labMissingWhy();
  if (why && process.env.BD_REQUIRE_LAB) throw new Error(`the ssh tests must run here: ${why}`);
  return why;
}

function labMissingWhy(): string | null {
  // the fake terminal uses util-linux's script(1); BSD's takes other words
  if (process.platform !== 'linux') return 'the ssh tests run on Linux only';
  if (!findSshd()) return 'no sshd (on Ubuntu: apt install openssh-server)';
  for (const n of ['ssh', 'ssh-keygen', 'ssh-keyscan', 'script']) if (!which(n)) return `no ${n}`;
  if (process.getuid?.() === 0 && !existsSync('/run/sshd')) {
    try {
      mkdirSync('/run/sshd', { mode: 0o755 });
    } catch {
      return 'running as root and /run/sshd cannot be made';
    }
  }
  return null;
}

/** what the pinned programs lack, in words; throws when they are there and are not what ORIGIN records */
function realProblems(): string[] {
  return [TESTBED, FRAMEWORK].flatMap((imp) => importProblems(imp, ROOT));
}

/**
 * why the real-gate lane cannot run here, or null when it can. It is opt-in: it runs only where a person
 * fetched hpcworker's `testbed` and `framework` exports into the folders git ignores (FETCH_COMMAND), and
 * a fetch that is not what ORIGIN records fails it rather than skipping it
 */
export function realGateMissing(): string | null {
  if (!fetched(TESTBED) && !fetched(FRAMEWORK)) return `hpcworker's framework and testbed are not fetched (${FETCH_COMMAND})`;
  const p = realProblems();
  if (p.length) throw new Error(`the pinned programs are not what their ORIGIN records, so nothing of them runs:\n${p.join('\n')}`);
  return labMissingWhy();
}

export async function startLab(opts: { gate?: 'standin' | 'real'; bashrc?: string } = {}): Promise<Lab> {
  const gate = opts.gate ?? 'standin';
  const sshd = findSshd()!;
  const E = mkdtempSync(join(tmpdir(), 'bd-'));
  chmodSync(E, 0o700);
  for (const d of ['host', 'cli', 'home/.ssh', 'state', 'sched', 'fakebin', 'bin', 'local', 'cfg', 'term', 'profiles']) mkdirSync(join(E, d), { recursive: true });
  const kg = (args: string[]) => {
    const r = spawnSync('ssh-keygen', ['-q', ...args], { stdio: 'ignore' });
    if (r.status !== 0) throw new Error(`ssh-keygen ${args.join(' ')}`);
  };
  kg(['-t', 'rsa', '-b', '2048', '-N', '', '-f', join(E, 'host/key')]);
  kg(['-t', 'ed25519', '-N', '', '-C', 'session', '-f', join(E, 'cli/session')]);
  kg(['-t', 'ed25519', '-N', '', '-C', 'nokey', '-f', join(E, 'cli/nokey')]);
  const hostB64 = readFileSync(join(E, 'host/key.pub'), 'utf8').split(' ')[1]!;
  const fingerprint = fingerprintOf(hostB64);
  writeFileSync(join(E, 'home/.ssh/authorized_keys'), readFileSync(join(E, 'cli/session.pub'), 'utf8'), { mode: 0o600 });
  if (opts.bashrc) writeFileSync(join(E, 'home/.bashrc'), opts.bashrc);

  // the lab's shared copy
  const site = 'e2etest';
  let version = '1';
  const extraEnv: string[] = [];
  if (gate === 'real') {
    // checked again here, right before anything of them is copied or run
    const p = realProblems();
    if (p.length) throw new Error(`the pinned programs are not what their ORIGIN records:\n${p.join('\n')}`);
    const fw = join(ROOT, FRAMEWORK.into);
    version = readFileSync(join(fw, 'VERSION'), 'utf8').trim();
    const v = join(E, 'shared', `v${version}`);
    mkdirSync(v, { recursive: true });
    // the copy as tools/deploy_shared.sh publishes it: the export is exactly those files
    for (const p of ['bin', 'lib', 'jobs', 'profiles', 'VERSION', 'README.md']) cpSync(join(fw, p), join(v, p), { recursive: true });
    // as the server repository's own e2e test does: this copy refuses any HOME but the lab's
    const src = readFileSync(join(fw, 'bin', 'hpcworker'), 'utf8').split('\n');
    const guard = `case "$HOME" in ${E}/home) ;; *) echo "E2E-GUARD refused HOME=$HOME" >&2; touch ${E}/GUARD-FIRED; exit 99;; esac`;
    writeFileSync(join(v, 'bin', 'hpcworker'), [src[0], guard, ...src.slice(1)].join('\n'), { mode: 0o755 });
    const wayne = JSON.parse(readFileSync(join(v, 'profiles', 'wayne.json'), 'utf8'));
    Object.assign(wayne, { site, shared_install: `${E}/shared/current`, shared_state_dir: `${E}/state`, binds: [], claude_config_dir: '$HOME/cfg', consent_markers: [] });
    writeFileSync(join(v, 'profiles', `${site}.json`), JSON.stringify(wayne, null, 1));
    // the testbed's scheduler first on the sessions' PATH, run as programs: each keeps its state in FAKE_SCHED_DIR
    const bin = join(ROOT, TESTBED.into, 'fakebin');
    for (const n of readdirSync(bin)) {
      cpSync(join(bin, n), join(E, 'fakebin', n));
      chmodSync(join(E, 'fakebin', n), 0o755);
    }
    extraEnv.push(`FAKE_SCHED_DIR=${E}/sched`);
  } else {
    mkdirSync(join(E, 'shared', 'v1', 'bin'), { recursive: true });
    cpSync(join(HERE, 'gate-standin.sh'), join(E, 'shared', 'v1', 'bin', 'hpcworker'));
    chmodSync(join(E, 'shared', 'v1', 'bin', 'hpcworker'), 0o755);
    extraEnv.push(`STANDIN_STATE=${E}/state`);
  }
  symlinkSync(`v${version}`, join(E, 'shared', 'current'));

  const port = await freePort();
  const sftpServer = ['/usr/lib/openssh/sftp-server', '/usr/libexec/openssh/sftp-server', '/usr/libexec/sftp-server'].find((p) => existsSync(p));
  const bashDir = (which('bash') ?? '/bin/bash').replace(/\/bash$/, '');
  const cfg = [
    `Port ${port}`, 'ListenAddress 127.0.0.1', `HostKey ${E}/host/key`, `PidFile ${E}/sshd.pid`,
    'KexAlgorithms curve25519-sha256,curve25519-sha256@libssh.org,ecdh-sha2-nistp256',
    'HostKeyAlgorithms rsa-sha2-512,rsa-sha2-256',
    'Ciphers aes128-ctr,aes192-ctr,aes256-ctr', 'MACs hmac-sha1',
    `AuthorizedKeysFile ${E}/home/.ssh/authorized_keys`, 'StrictModes no',
    'PasswordAuthentication no', 'KbdInteractiveAuthentication no', 'UsePAM no', 'PrintMotd no', 'PrintLastLog no',
    'PermitRootLogin prohibit-password', 'MaxStartups 50', 'MaxSessions 20',
    // the grid's sftp is sshd's own sftp-server, started through the account's shell
    `Subsystem sftp ${sftpServer ?? 'internal-sftp'}`,
    `SetEnv HOME=${E}/home PATH=${E}/fakebin:${bashDir}:/usr/bin:/bin ${extraEnv.join(' ')}`,
    'LogLevel DEBUG1',
  ];
  writeFileSync(join(E, 'sshd_config'), cfg.join('\n') + '\n');
  const t = spawnSync(sshd, ['-t', '-f', join(E, 'sshd_config')], { encoding: 'utf8' });
  if (t.status !== 0) throw new Error(`sshd -t: ${t.stderr}`);
  const child: ChildProcess = spawn(sshd, ['-D', '-f', join(E, 'sshd_config'), '-E', join(E, 'sshd.log')], { stdio: 'ignore' });

  // the ssh our server runs: the lab's config only, never this account's own keys, agent or known_hosts
  const sshBin = which('ssh')!;
  writeFileSync(join(E, 'cfg/calls'), `IdentityFile ${E}/cli/nokey\nIdentitiesOnly yes\nIdentityAgent none\n`);
  writeFileSync(join(E, 'cfg/signin'), `IdentityFile ${E}/cli/session\nIdentitiesOnly yes\nIdentityAgent none\n`);
  writeFileSync(join(E, 'bin/ssh'), `#!/bin/sh\nif [ -n "\${BD_TEST_SIGNIN:-}" ]; then exec ${sshBin} -F ${E}/cfg/signin "$@"; fi\nexec ${sshBin} -F ${E}/cfg/calls "$@"\n`, { mode: 0o755 });
  writeFileSync(join(E, 'bin/ssh-keyscan'), `#!/bin/sh\nexec ${which('ssh-keyscan')} "$@"\n`, { mode: 0o755 });
  // the student's terminal: the launcher under a pseudo-terminal, typing nothing; after a few seconds its
  // input ends, as when the student closes the window, and the kept sign-in must outlive it
  writeFileSync(
    join(E, 'term/xterm'),
    `#!/bin/sh\n[ "$1" = -e ] && shift\n(sleep 6 | BD_TEST_SIGNIN=1 script -qec "$1" /dev/null > ${E}/term.log 2>&1 &)\n`,
    { mode: 0o755 },
  );
  // Debian's alternatives name comes first in the server's list, so the fake answers to it too
  symlinkSync('xterm', join(E, 'term/x-terminal-emulator'));

  const account = userInfo().username;
  const wayne = JSON.parse(readFileSync(join(ROOT, 'profiles', 'wayne.json'), 'utf8')) as Record<string, unknown>;
  const profileRaw = {
    ...wayne,
    site,
    session_title: 'test grid',
    ssh_host: '127.0.0.1',
    ssh_port: port,
    ssh_host_key: fingerprint,
    shared_install: `${E}/shared/current`,
    shared_state_dir: `${E}/state`,
    vpn_required: false,
  };
  writeFileSync(join(E, 'profiles', `${site}.json`), JSON.stringify(profileRaw, null, 1));

  // ready when sshd answers a scan
  for (let i = 0; i < 50; i++) {
    const r = spawnSync('ssh-keyscan', ['-T', '2', '-p', String(port), '127.0.0.1'], { encoding: 'utf8' });
    if (r.stdout.includes('ssh-rsa')) break;
    await new Promise((r2) => setTimeout(r2, 100));
  }

  return {
    dir: E,
    port,
    account,
    fingerprint,
    site,
    profiles: join(E, 'profiles'),
    profileRaw,
    ssh: join(E, 'bin/ssh'),
    localHome: join(E, 'local'),
    state: join(E, 'state'),
    home: join(E, 'home'),
    fakeTerm: join(E, 'term'),
    gate,
    sshdLog: join(E, 'sshd.log'),
    stop: () => {
      // the kept sign-in of the tests, then sshd, then the folder
      spawnSync('sh', ['-c', `for s in ${E}/local/.beethoven-desktop/cm-*; do [ -S "$s" ] && ${sshBin} -o ControlPath="$s" -O exit x 2>/dev/null; done; true`]);
      child.kill('SIGTERM');
      rmSync(E, { recursive: true, force: true });
    },
  };
}

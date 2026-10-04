// A read-only SFTP version 3 client (draft-ietf-secsh-filexfer-02) over an `ssh -s ... sftp` child:
// sshd's own sftp-server does the work on the grid, so a file view runs no shell command of ours and
// nothing warrior's banner bans. Only the requests a reader needs are here: REALPATH, LSTAT, FSTAT,
// OPENDIR, READDIR, OPEN for reading, READ, CLOSE. Nothing that writes, renames or removes exists.
import type { ChildProcessWithoutNullStreams } from 'node:child_process';

const T = {
  INIT: 1, VERSION: 2, OPEN: 3, CLOSE: 4, READ: 5, LSTAT: 7, FSTAT: 8, OPENDIR: 11, READDIR: 12, REALPATH: 16,
  STATUS: 101, HANDLE: 102, DATA: 103, NAME: 104, ATTRS: 105,
} as const;
const FX = { OK: 0, EOF: 1, NO_SUCH_FILE: 2, PERMISSION_DENIED: 3 } as const;
const ATTR = { SIZE: 0x1, UIDGID: 0x2, PERMISSIONS: 0x4, ACMODTIME: 0x8, EXTENDED: 0x80000000 } as const;
const READ_FLAG = 0x1;
/** a reply larger than this is not an sftp reply */
const MAX_PACKET = 512 * 1024;
/** at most this much shell text is skipped before the session's first reply */
const PRELUDE_MAX = 64 * 1024;
const CHUNK = 32 * 1024;

export type Kind = 'file' | 'dir' | 'link' | 'other';

export interface Attrs {
  size?: number;
  mode?: number;
  mtime?: number;
}

export interface Entry {
  name: string;
  kind: Kind;
  size?: number;
  mtime?: number;
}

export class SftpError extends Error {
  constructor(public readonly code: number | 'protocol' | 'closed', message: string) {
    super(message);
  }
  get missing(): boolean {
    return this.code === FX.NO_SUCH_FILE;
  }
  get denied(): boolean {
    return this.code === FX.PERMISSION_DENIED;
  }
}

export function kindOf(mode: number | undefined): Kind {
  if (mode === undefined) return 'other';
  switch (mode & 0o170000) {
    case 0o100000:
      return 'file';
    case 0o040000:
      return 'dir';
    case 0o120000:
      return 'link';
    default:
      return 'other';
  }
}

class Reader {
  private o = 0;
  constructor(private readonly b: Buffer) {}
  u8(): number {
    this.need(1);
    return this.b.readUInt8(this.o++);
  }
  u32(): number {
    this.need(4);
    const v = this.b.readUInt32BE(this.o);
    this.o += 4;
    return v;
  }
  u64(): number {
    this.need(8);
    const v = this.b.readBigUInt64BE(this.o);
    this.o += 8;
    return Number(v);
  }
  bytes(): Buffer {
    const n = this.u32();
    this.need(n);
    const v = this.b.subarray(this.o, this.o + n);
    this.o += n;
    return v;
  }
  str(): string {
    return this.bytes().toString('utf8');
  }
  attrs(): Attrs {
    const flags = this.u32();
    const a: Attrs = {};
    if (flags & ATTR.SIZE) a.size = this.u64();
    if (flags & ATTR.UIDGID) {
      this.u32();
      this.u32();
    }
    if (flags & ATTR.PERMISSIONS) a.mode = this.u32();
    if (flags & ATTR.ACMODTIME) {
      this.u32();
      a.mtime = this.u32();
    }
    if (flags & ATTR.EXTENDED) {
      const n = this.u32();
      for (let i = 0; i < n; i++) {
        this.bytes();
        this.bytes();
      }
    }
    return a;
  }
  private need(n: number): void {
    if (this.o + n > this.b.length) throw new SftpError('protocol', 'a short sftp reply');
  }
}

function u32(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n >>> 0);
  return b;
}
function u64(n: number): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigUInt64BE(BigInt(n));
  return b;
}
function str(s: string | Buffer): Buffer {
  const b = typeof s === 'string' ? Buffer.from(s, 'utf8') : s;
  return Buffer.concat([u32(b.length), b]);
}
function packet(type: number, parts: Buffer[]): Buffer {
  const body = Buffer.concat([Buffer.from([type]), ...parts]);
  return Buffer.concat([u32(body.length), body]);
}

type Waiter = { resolve: (r: { type: number; r: Reader }) => void; reject: (e: Error) => void };

export class Sftp {
  private buf = Buffer.alloc(0);
  private nextId = 1;
  private readonly waiting = new Map<number, Waiter>();
  private versionWaiter: Waiter | null = null;
  private synced = false;
  private dead: SftpError | null = null;
  private stderr = '';

  private constructor(private readonly child: ChildProcessWithoutNullStreams) {
    child.stdout.on('data', (b: Buffer) => this.onData(b));
    child.stderr.on('data', (b: Buffer) => {
      if (this.stderr.length < 8192) this.stderr += b.toString('utf8');
    });
    child.on('close', () => this.fail(new SftpError('closed', this.stderr.trim() || 'the sftp session ended')));
    child.on('error', (e) => this.fail(new SftpError('closed', e.message)));
    child.stdin.on('error', () => {});
  }

  /** speak INIT/VERSION over a started `ssh -s host sftp`; refuses anything but version 3 or later */
  static async start(child: ChildProcessWithoutNullStreams, timeoutMs = 30_000): Promise<Sftp> {
    const s = new Sftp(child);
    const got = new Promise<{ type: number; r: Reader }>((resolve, reject) => (s.versionWaiter = { resolve, reject }));
    child.stdin.write(packet(T.INIT, [u32(3)]));
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new SftpError('closed', 'the sftp session did not answer')), timeoutMs);
    });
    try {
      const { type, r } = await Promise.race([got, timeout]);
      if (type !== T.VERSION || r.u32() < 3) throw new SftpError('protocol', 'not an sftp version 3 server');
      return s;
    } catch (e) {
      s.close();
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  get lastStderr(): string {
    return this.stderr;
  }

  close(): void {
    try {
      this.child.stdin.end();
    } catch {
      // already gone
    }
    this.child.kill('SIGTERM');
    this.fail(new SftpError('closed', 'closed'));
  }

  async realpath(path: string): Promise<string> {
    const { type, r } = await this.request(T.REALPATH, [str(path)]);
    if (type !== T.NAME || r.u32() < 1) throw new SftpError('protocol', 'no name for realpath');
    return r.str();
  }

  async lstat(path: string): Promise<Attrs> {
    return this.attrsOf(await this.request(T.LSTAT, [str(path)]));
  }

  async readdir(path: string, max = 1000): Promise<Entry[]> {
    const h = await this.handle(await this.request(T.OPENDIR, [str(path)]));
    const out: Entry[] = [];
    try {
      while (out.length < max) {
        const { type, r } = await this.request(T.READDIR, [str(h)]);
        if (type === T.STATUS) {
          const code = r.u32();
          if (code === FX.EOF) break;
          throw new SftpError(code, r.str());
        }
        if (type !== T.NAME) throw new SftpError('protocol', 'not a name list');
        const n = r.u32();
        for (let i = 0; i < n; i++) {
          const name = r.str();
          r.str(); // the long name: never parsed, the attributes say everything
          const a = r.attrs();
          if (name === '.' || name === '..') continue;
          out.push({ name, kind: kindOf(a.mode), size: a.size, mtime: a.mtime });
        }
      }
    } finally {
      await this.closeHandle(h);
    }
    return out;
  }

  /**
   * At most `max` bytes of a file opened for reading. `check` sees the open file's own attributes (FSTAT)
   * before a byte is read, and refuses by throwing.
   */
  async readFile(path: string, max: number, check?: (a: Attrs) => void): Promise<{ data: Buffer; size?: number }> {
    const h = await this.handle(await this.request(T.OPEN, [str(path), u32(READ_FLAG), u32(0)]));
    try {
      const a = this.attrsOf(await this.request(T.FSTAT, [str(h)]));
      check?.(a);
      const parts: Buffer[] = [];
      let off = 0;
      while (off < max) {
        const { type, r } = await this.request(T.READ, [str(h), u64(off), u32(Math.min(CHUNK, max - off))]);
        if (type === T.STATUS) {
          const code = r.u32();
          if (code === FX.EOF) break;
          throw new SftpError(code, r.str());
        }
        if (type !== T.DATA) throw new SftpError('protocol', 'not data');
        const d = r.bytes();
        if (d.length === 0) break;
        parts.push(d);
        off += d.length;
      }
      return { data: Buffer.concat(parts), size: a.size };
    } finally {
      await this.closeHandle(h);
    }
  }

  private async closeHandle(h: Buffer): Promise<void> {
    try {
      await this.request(T.CLOSE, [str(h)]);
    } catch {
      // the session may already be gone; nothing was open for writing
    }
  }

  private attrsOf({ type, r }: { type: number; r: Reader }): Attrs {
    if (type === T.STATUS) {
      const code = r.u32();
      throw new SftpError(code, r.str());
    }
    if (type !== T.ATTRS) throw new SftpError('protocol', 'not attributes');
    return r.attrs();
  }

  private handle({ type, r }: { type: number; r: Reader }): Buffer {
    if (type === T.STATUS) {
      const code = r.u32();
      throw new SftpError(code, r.str());
    }
    if (type !== T.HANDLE) throw new SftpError('protocol', 'not a handle');
    return Buffer.from(r.bytes());
  }

  private request(type: number, parts: Buffer[]): Promise<{ type: number; r: Reader }> {
    if (this.dead) return Promise.reject(this.dead);
    const id = this.nextId++ >>> 0;
    return new Promise((resolve, reject) => {
      this.waiting.set(id, { resolve, reject });
      this.child.stdin.write(packet(type, [u32(id), ...parts]));
    });
  }

  // sshd starts sftp-server through the account's shell, and a shell that reads a ~/.bashrc which prints
  // puts that text ahead of the first packet (OpenSSH's own sftp then fails with "message too long").
  // Before the VERSION reply, bytes up to the first one that reads as that reply are the shell's, skipped.
  private skipShellText(): boolean {
    for (let i = 0; i + 9 <= this.buf.length; i++) {
      const len = this.buf.readUInt32BE(i);
      if (len >= 5 && len <= 64 * 1024 && this.buf[i + 4] === T.VERSION && this.buf.readUInt32BE(i + 5) >= 3 && this.buf.readUInt32BE(i + 5) < 256) {
        this.buf = this.buf.subarray(i);
        this.synced = true;
        return true;
      }
    }
    if (this.buf.length > PRELUDE_MAX) {
      this.fail(new SftpError('protocol', 'the grid account printed too much text before the file session began (a ~/.bashrc that prints?)'));
      this.child.kill('SIGTERM');
    }
    return false;
  }

  private onData(b: Buffer): void {
    this.buf = Buffer.concat([this.buf, b]);
    if (!this.synced && !this.skipShellText()) return;
    while (this.buf.length >= 4) {
      const len = this.buf.readUInt32BE(0);
      if (len < 1 || len > MAX_PACKET) {
        this.fail(new SftpError('protocol', 'the file session sent something that is not sftp'));
        this.child.kill('SIGTERM');
        return;
      }
      if (this.buf.length < 4 + len) return;
      const body = this.buf.subarray(4, 4 + len);
      this.buf = this.buf.subarray(4 + len);
      const r = new Reader(body);
      try {
        const type = r.u8();
        if (type === T.VERSION) {
          const w = this.versionWaiter;
          this.versionWaiter = null;
          w?.resolve({ type, r });
          continue;
        }
        const id = r.u32();
        const w = this.waiting.get(id);
        if (!w) continue;
        this.waiting.delete(id);
        w.resolve({ type, r });
      } catch (e) {
        this.fail(e instanceof SftpError ? e : new SftpError('protocol', String(e)));
        return;
      }
    }
  }

  private fail(e: SftpError): void {
    if (!this.dead) this.dead = e;
    this.versionWaiter?.reject(e);
    this.versionWaiter = null;
    for (const w of this.waiting.values()) w.reject(e);
    this.waiting.clear();
  }
}

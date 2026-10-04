// The worker's working folder, read over sftp: <state_dir>/workspaces/<name>, and nothing outside it.
// The worker is an agent that can write into this folder, links included, so a path is never trusted by
// its spelling: the folder a request names is resolved on the grid (REALPATH) and must lie inside the
// workspace's own resolved root, the file itself must be a plain file by LSTAT (a link is refused, not
// followed), names that hold credentials are refused by name, and what is read passes the credential
// redactor before it reaches the model. Between LSTAT and OPEN the worker could swap the file for a link;
// the open file's own size and time (FSTAT) must then still match, and the redactor stays the last wall.
import { redactCredentials } from './redact.js';
import { SftpError, type Entry, type Sftp } from './sftp.js';

export const DEFAULT_READ = 256 * 1024;
export const MAX_READ = 1024 * 1024;
export const MAX_LIST = 500;

export class WorkspaceError extends Error {
  constructor(public readonly why: 'bad-path' | 'outside' | 'missing' | 'not-file' | 'not-dir' | 'refused-name' | 'too-large' | 'denied' | 'changed', message: string) {
    super(message);
  }
}

/** names that hold a credential or a key wherever they are; never listed as readable and never read */
export function refusedName(name: string): boolean {
  const n = name.toLowerCase();
  return (
    n === '.credentials.json' ||
    n === '.claude.json' ||
    n === 'job.token' ||
    n.endsWith('.token') ||
    n === '.netrc' ||
    n === '.env' ||
    n.startsWith('.env.') ||
    n.endsWith('.pem') ||
    n.endsWith('.key') ||
    /^id_(?:rsa|dsa|ecdsa|ed25519)(?:_sk)?$/.test(n)
  );
}

/** a path inside the workspace, relative, in plain segments: never absolute, never "." or "..", never a control character */
export function segmentsOf(rel: string): string[] {
  const s = String(rel ?? '').replace(/\\/g, '/');
  if (s.length > 1024) throw new WorkspaceError('bad-path', 'That path is too long.');
  if (s.startsWith('/')) throw new WorkspaceError('bad-path', 'Give a path inside the workspace, not one from the top of the grid.');
  const parts = s.split('/').filter((p) => p !== '');
  for (const p of parts) {
    if (p === '.' || p === '..') throw new WorkspaceError('bad-path', 'A path may not use "." or "..".');
    if (/[\x00-\x1f\x7f]/.test(p) || p.length > 255) throw new WorkspaceError('bad-path', 'That path has a character a file name cannot have.');
  }
  return parts;
}

function inside(root: string, p: string): boolean {
  return p === root || p.startsWith(root.endsWith('/') ? root : root + '/');
}

export interface Workspace {
  /** the workspace's root as the grid resolves it */
  root: string;
}

export async function openWorkspace(sftp: Sftp, stateDir: string, worker: string): Promise<Workspace> {
  const named = `${stateDir}/workspaces/${worker}`;
  try {
    return { root: await sftp.realpath(named) };
  } catch (e) {
    if (e instanceof SftpError && e.missing) throw new WorkspaceError('missing', `The worker "${worker}" has no workspace yet; it is made when the worker first starts.`);
    if (e instanceof SftpError && e.denied) throw new WorkspaceError('denied', 'The grid refused to show the workspace to this account.');
    throw e;
  }
}

async function resolveDir(sftp: Sftp, ws: Workspace, parts: string[]): Promise<string> {
  const named = [ws.root, ...parts].join('/');
  let real: string;
  try {
    real = await sftp.realpath(named);
  } catch (e) {
    if (e instanceof SftpError && e.missing) throw new WorkspaceError('missing', 'There is no such folder in the workspace.');
    throw e;
  }
  if (!inside(ws.root, real)) throw new WorkspaceError('outside', 'That folder leads outside the workspace, so Beethoven will not open it.');
  return real;
}

export interface Listing {
  path: string;
  entries: Array<Entry & { readable: boolean }>;
  truncated: boolean;
}

export async function listDir(sftp: Sftp, ws: Workspace, rel: string): Promise<Listing> {
  const parts = segmentsOf(rel);
  const dir = await resolveDir(sftp, ws, parts);
  let entries: Entry[];
  try {
    entries = await sftp.readdir(dir, MAX_LIST + 1);
  } catch (e) {
    if (e instanceof SftpError && (e.missing || e.code === 4)) throw new WorkspaceError('not-dir', 'That is not a folder.');
    if (e instanceof SftpError && e.denied) throw new WorkspaceError('denied', 'The grid refused to list that folder.');
    throw e;
  }
  const truncated = entries.length > MAX_LIST;
  const out = entries
    .slice(0, MAX_LIST)
    .map((e) => ({ ...e, readable: e.kind === 'file' && !refusedName(e.name) }))
    .sort((a, b) => (a.kind === 'dir' ? 0 : 1) - (b.kind === 'dir' ? 0 : 1) || a.name.localeCompare(b.name));
  return { path: parts.join('/'), entries: out, truncated };
}

export interface FileText {
  path: string;
  size: number;
  shown: number;
  binary: boolean;
  text: string;
}

export async function readText(sftp: Sftp, ws: Workspace, rel: string, maxBytes = DEFAULT_READ): Promise<FileText> {
  const parts = segmentsOf(rel);
  const base = parts.pop();
  if (!base) throw new WorkspaceError('bad-path', 'Name a file.');
  if (refusedName(base)) throw new WorkspaceError('refused-name', 'Beethoven never opens a file of that name: it may hold a credential.');
  const cap = Math.max(1, Math.min(MAX_READ, Math.floor(maxBytes)));
  const dir = await resolveDir(sftp, ws, parts);
  const file = `${dir}/${base}`;
  let st;
  try {
    st = await sftp.lstat(file);
  } catch (e) {
    if (e instanceof SftpError && e.missing) throw new WorkspaceError('missing', 'There is no such file in the workspace.');
    if (e instanceof SftpError && e.denied) throw new WorkspaceError('denied', 'The grid refused to open that file.');
    throw e;
  }
  const kind = st.mode === undefined ? 'other' : (st.mode & 0o170000) === 0o100000 ? 'file' : (st.mode & 0o170000) === 0o120000 ? 'link' : 'other';
  if (kind === 'link') throw new WorkspaceError('not-file', 'That name is a link; Beethoven opens plain files only, so a link cannot lead outside the workspace.');
  if (kind !== 'file') throw new WorkspaceError('not-file', 'That is not a plain file.');
  const { data, size } = await sftp.readFile(file, cap, (a) => {
    const plain = a.mode !== undefined && (a.mode & 0o170000) === 0o100000;
    if (!plain || a.size !== st.size || (a.mtime !== undefined && st.mtime !== undefined && a.mtime !== st.mtime)) {
      throw new WorkspaceError('changed', 'The file changed while it was being opened; ask again.');
    }
  });
  const head = data.subarray(0, 8192);
  const binary = head.includes(0);
  return {
    path: [...parts, base].join('/'),
    size: size ?? data.length,
    shown: binary ? 0 : data.length,
    binary,
    text: binary ? '' : redactCredentials(data.toString('utf8')),
  };
}

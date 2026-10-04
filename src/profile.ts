// A site profile, read as data from the bundle (profiles/<site>.json, vendored from the server
// repository). Only the keys below are read; the rest of the file is the cluster's business.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PERMISSION_MODES, SITE_RE, type PermissionMode } from './contract.js';

export interface SiteProfile {
  site: string;
  displayName: string;
  sessionTitle: string;
  sshHost: string;
  sshPort: number;
  /** SHA256:<43 base64 characters>, as ssh-keygen -l prints it */
  sshHostKey: string;
  /** the lab's shared copy of hpcworker (its `current` link) */
  sharedInstall: string;
  /** may hold $USER, expanded with the account name */
  sharedStateDir: string;
  permissionMode: PermissionMode;
  vpnRequired: boolean;
  vpnApp: string;
}

export const DEFAULT_PROFILES_DIR = fileURLToPath(new URL('../profiles/', import.meta.url));

const HOST_RE = /^[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$/;
const FP_RE = /^SHA256:[A-Za-z0-9+/]{43}$/;
const ABS_RE = /^\/[A-Za-z0-9._/$-]+$/;

export class ProfileError extends Error {}

export function loadProfile(site: string, dir: string = DEFAULT_PROFILES_DIR): SiteProfile {
  if (!SITE_RE.test(site)) throw new ProfileError(`"${site}" is not a site name`);
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(readFileSync(join(dir, `${site}.json`), 'utf8')) as Record<string, unknown>;
  } catch {
    throw new ProfileError(`no site profile named "${site}" in this build`);
  }
  return profileFrom(raw, site);
}

export function profileFrom(raw: Record<string, unknown>, site: string): SiteProfile {
  const str = (k: string): string => {
    const v = raw[k];
    if (typeof v !== 'string' || !v) throw new ProfileError(`the "${site}" profile has no ${k}`);
    return v;
  };
  const sshHost = str('ssh_host');
  if (!HOST_RE.test(sshHost)) throw new ProfileError(`the "${site}" profile's ssh_host is not a host name`);
  const sshPort = typeof raw.ssh_port === 'number' ? raw.ssh_port : 22;
  if (!Number.isInteger(sshPort) || sshPort < 1 || sshPort > 65535) throw new ProfileError(`the "${site}" profile's ssh_port is not a port`);
  const sshHostKey = str('ssh_host_key');
  if (!FP_RE.test(sshHostKey)) throw new ProfileError(`the "${site}" profile's ssh_host_key is not a SHA256 fingerprint`);
  const sharedInstall = str('shared_install');
  if (!ABS_RE.test(sharedInstall) || sharedInstall.includes('$') || sharedInstall.split('/').includes('..')) {
    throw new ProfileError(`the "${site}" profile's shared_install is not a plain absolute path`);
  }
  const sharedStateDir = str('shared_state_dir');
  if (!ABS_RE.test(sharedStateDir) || sharedStateDir.split('/').includes('..')) {
    throw new ProfileError(`the "${site}" profile's shared_state_dir is not a plain absolute path`);
  }
  const wd = (raw.worker_defaults ?? {}) as Record<string, unknown>;
  const pm = PERMISSION_MODES.includes(wd.permission_mode as PermissionMode) ? (wd.permission_mode as PermissionMode) : 'default';
  return {
    site,
    displayName: typeof raw.display_name === 'string' ? raw.display_name : site,
    sessionTitle: typeof raw.session_title === 'string' ? raw.session_title : 'Grid worker',
    sshHost,
    sshPort,
    sshHostKey,
    sharedInstall,
    sharedStateDir,
    permissionMode: pm,
    vpnRequired: raw.vpn_required === true,
    vpnApp: typeof raw.vpn_app === 'string' ? raw.vpn_app : '',
  };
}

/** the account's state directory, with $USER (the only variable a profile's state dir uses) expanded */
export function stateDirFor(p: SiteProfile, account: string): string {
  const d = p.sharedStateDir.replace(/\$\{USER\}|\$USER\b/g, account).replace(/\/+$/, '');
  if (d.includes('$')) throw new ProfileError(`the "${p.site}" profile's shared_state_dir names a variable this edition cannot expand`);
  return d;
}

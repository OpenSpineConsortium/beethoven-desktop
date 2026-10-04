// What the student set in Claude Desktop's settings for this extension (manifest.json user_config) or
// in the Claude Code plugin's userConfig, handed to the server as environment variables. None of them
// is a secret: there is no field for a password, a code, a key or a token, here or in either manifest.
import { ACCOUNT_RE, WORKER_NAME_RE } from './contract.js';

export interface Config {
  site: string;
  /** the grid account name (AccessID); empty until the student sets it */
  account: string;
  worker: string;
  /** Windows only: run OpenSSH inside WSL, whose ssh can keep one sign-in for every tool */
  useWsl: boolean;
  /** an ssh program other than the system's, when the student names one */
  sshPath: string;
}

export const ENV = {
  site: 'BEETHOVEN_DESKTOP_SITE',
  account: 'BEETHOVEN_DESKTOP_ACCOUNT',
  worker: 'BEETHOVEN_DESKTOP_WORKER',
  useWsl: 'BEETHOVEN_DESKTOP_USE_WSL',
  sshPath: 'BEETHOVEN_DESKTOP_SSH',
} as const;

/** an unset optional field can arrive as "" or as the placeholder text itself, depending on the host */
function value(env: NodeJS.ProcessEnv, k: string): string {
  const v = (env[k] ?? '').trim();
  return /^\$\{user_config\.[A-Za-z0-9_]+\}$/.test(v) ? '' : v;
}

export function configFrom(env: NodeJS.ProcessEnv): { config: Config; problems: string[] } {
  const problems: string[] = [];
  const site = value(env, ENV.site) || 'wayne';
  const account = value(env, ENV.account).toLowerCase();
  if (account && !ACCOUNT_RE.test(account)) problems.push('The grid account name in the settings is not an account name.');
  const worker = value(env, ENV.worker) || 'worker';
  if (!WORKER_NAME_RE.test(worker)) problems.push('The worker name in the settings may use letters, digits, - and _ only, at most 32.');
  const useWsl = /^(true|1|yes)$/i.test(value(env, ENV.useWsl));
  const sshPath = value(env, ENV.sshPath);
  return {
    config: { site, account: ACCOUNT_RE.test(account) ? account : '', worker: WORKER_NAME_RE.test(worker) ? worker : 'worker', useWsl, sshPath },
    problems,
  };
}

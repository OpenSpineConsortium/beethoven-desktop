// The student's sign-in happens in a terminal window of their own, in ssh's own prompt. This edition
// writes a small launcher into its own owner-only folder (the ssh line and three plain sentences, no
// secret: there is none to write) and asks the operating system to open it in its terminal app. Nothing
// typed in that window passes through this process. The same goes for links: one checked link is handed
// to the operating system's opener, and the browser opens it; nothing of ours runs on that page.
import { spawn } from 'node:child_process';
import { chmodSync, existsSync, renameSync, writeFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { isClaudeCodeLink } from './contract.js';
import { childEnv } from './ssh.js';

/** POSIX sh: every word in single quotes */
export function shQuote(w: string): string {
  return `'${w.replace(/'/g, `'\\''`)}'`;
}

/** cmd.exe in a .cmd file: every word in double quotes; a word with a double quote is never built; % doubled */
export function cmdQuote(w: string): string {
  if (w.includes('"') || /[\r\n]/.test(w)) throw new Error('a word cmd cannot quote');
  return `"${w.replace(/%/g, '%%')}"`;
}

export function signInLines(siteTitle: string, mux: boolean): string[] {
  const keep = mux
    ? 'Once you are signed in you may close this window; Beethoven keeps the sign-in for four hours after its last use.'
    : 'Keep this window open while you use Beethoven.';
  return [
    `Beethoven: sign in to the ${siteTitle} below.`,
    'Type your grid password, and your one-time code if the grid asks for one, when ssh asks. Beethoven never sees them.',
    keep,
  ];
}

export function launcherText(platform: NodeJS.Platform, argv: string[], lines: string[]): string {
  if (platform === 'win32') {
    const echo = lines.map((l) => `echo ${l.replace(/[%^&|<>()]/g, (c) => (c === '%' ? '%%' : `^${c}`))}`);
    return ['@echo off', 'title Beethoven', ...echo, 'echo.', argv.map(cmdQuote).join(' '), ''].join('\r\n');
  }
  return [
    '#!/bin/sh',
    'clear 2>/dev/null',
    `printf '%s\\n' ${lines.map(shQuote).join(' ')} ''`,
    `exec ${argv.map(shQuote).join(' ')}`,
    '',
  ].join('\n');
}

export function launcherName(platform: NodeJS.Platform): string {
  return platform === 'win32' ? 'sign-in.cmd' : platform === 'darwin' ? 'sign-in.command' : 'sign-in.sh';
}

export function writeLauncher(dir: string, platform: NodeJS.Platform, argv: string[], lines: string[]): string {
  const path = join(dir, launcherName(platform));
  const part = `${path}.part`;
  writeFileSync(part, launcherText(platform, argv, lines), { mode: 0o700 });
  if (platform !== 'win32') chmodSync(part, 0o700);
  renameSync(part, path);
  return path;
}

/** on Linux, the first terminal app found on PATH, with the words that make it run one program */
const LINUX_TERMINALS: Array<[string, string[]]> = [
  ['x-terminal-emulator', ['-e']],
  ['gnome-terminal', ['--']],
  ['konsole', ['-e']],
  ['xfce4-terminal', ['-x']],
  ['kitty', []],
  ['alacritty', ['-e']],
  ['xterm', ['-e']],
];

function onPath(name: string, env: NodeJS.ProcessEnv): boolean {
  return (env.PATH ?? '').split(delimiter).some((d) => d && existsSync(join(d, name)));
}

/** the program that opens the launcher in a terminal window, or null when this computer has none we know */
export function terminalArgv(platform: NodeJS.Platform, launcher: string, env: NodeJS.ProcessEnv = process.env): string[] | null {
  if (platform === 'darwin') return ['open', '-a', 'Terminal', launcher];
  // `start` gives the launcher a console window of its own; the title is start's first quoted word
  if (platform === 'win32') {
    // a command line, not a .cmd file: % is not doubled here, so a path holding one is never placed
    if (/["%\r\n]/.test(launcher)) return null;
    return ['cmd.exe', '/d', '/c', `start "Beethoven" "${launcher}"`];
  }
  for (const [name, pre] of LINUX_TERMINALS) if (onPath(name, env)) return [name, ...pre, launcher];
  return null;
}

/** the operating system's opener for a Claude Code link; any other text is refused before a program starts */
export function openerArgv(platform: NodeJS.Platform, url: string): string[] {
  if (!isClaudeCodeLink(url)) throw new Error('not a Claude Code link');
  if (platform === 'darwin') return ['open', url];
  if (platform === 'win32') return ['rundll32.exe', 'url.dll,FileProtocolHandler', url];
  return ['xdg-open', url];
}

/** start a program detached from this server, its output ignored; true when it started */
export function launch(argv: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const verbatim = argv[0] === 'cmd.exe';
      const child = spawn(argv[0]!, argv.slice(1), { detached: true, stdio: 'ignore', shell: false, windowsHide: false, windowsVerbatimArguments: verbatim, env: childEnv() });
      child.on('error', () => resolve(false));
      child.on('spawn', () => {
        child.unref();
        resolve(true);
      });
    } catch {
      resolve(false);
    }
  });
}

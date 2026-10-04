// The posture, checked on the code that ships: fails the build when the server could reach the network
// by itself, run code from text, read a Claude credential, put Claude Code on an API key, hand ssh a
// password, or delete a file.
//
//   node scripts/forbidden.mjs [DIR]        (default: src; the build runs it on dist/beethoven/server)
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, relative } from 'node:path';

const dir = process.argv[2] ?? 'src';
const files = [];
const walk = (d) => {
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(?:[cm]?js|ts)$/.test(n)) files.push(p);
  }
};
walk(dir);
if (files.length === 0) {
  console.error(`forbidden: no code under ${dir}`);
  process.exit(1);
}

// the only modules the server may import: Node's own, for processes, files, paths and one hash
const ALLOWED_IMPORTS = new Set(['node:child_process', 'node:crypto', 'node:fs', 'node:os', 'node:path', 'node:url']);

// The lines where a name below may stand because it is taken away there, never set, read or offered: the
// variables no child gets (ssh's DROP_ENV) and a redaction pattern. A name anywhere else fails. The line
// must be one regular expression and nothing more: its body takes no bare `/` outside a [class], so no
// code can ride along between two patterns on an allowed line.
const STRIP_SITES = [
  [['ssh.js', 'ssh.ts'], /^const DROP_ENV = \/(?:\\.|\[(?:\\.|[^\]\\])*\]|[^\/\\[])+\/[a-z]*;$/],
  [['redact.js', 'redact.ts'], /^\[\/(?:\\.|\[(?:\\.|[^\]\\])*\]|[^\/\\[])+\/[a-z]*, '[^']*\[redacted\][^']*'\],$/],
];

const RULES = [
  [/\bfetch\s*\(/, 'a network request (fetch)'],
  [/\bXMLHttpRequest\b|\bWebSocket\b|\bEventSource\b/, 'a network client'],
  [/\beval\s*\(|\bnew\s+Function\s*\(/, 'code from text'],
  [/(?<![.\w])exec(?:Sync)?\s*\(|\bexecFile(?:Sync)?\b|\bfork\s*\(|shell:\s*true/, 'a shell (spawn with shell: false only)'],
  [/\bsshpass\b|\bexpect\s+-|PasswordAuthentication|SSH_ASKPASS|KbdInteractive/i, 'a password handed to ssh'],
  [/setup-token|CLAUDE_CODE_OAUTH_TOKEN|auth logout/, 'a Claude credential or sign-out', STRIP_SITES],
  // no API key anywhere (greg, 2026-10-04 13:27Z): a key, a token, a gateway, a cloud provider, the
  // Console's sign-in or its pages would each put Claude Code on something other than the subscription
  [
    /ANTHROPIC_(?:API_KEY|AUTH_TOKEN|BASE_URL)|CLAUDE_CODE_(?:API_KEY_FILE_DESCRIPTOR|USE_(?:BEDROCK|VERTEX|FOUNDRY))|apiKeyHelper|console\.anthropic\.com|platform\.claude\.com|sk-ant-|--console\b/i,
    'an API key, a gateway or a cloud provider for Claude Code',
    STRIP_SITES,
  ],
  [/~\/\.claude\b|\.beethoven\/claude|\.ashley\/claude|claude_config_dir/, "the Claude sign-in's folder"],
  [/\b(?:rmSync|rmdirSync|unlinkSync|unlink|rmdir)\s*\(|\bfs\.rm\b/, 'a deletion'],
  [/\bconsole\.(?:log|info|debug|warn|error)\b/, 'output beside the protocol (stdout is MCP only)'],
  [/['"`](?:forget|watch|restrict)\b/, 'a gate verb this edition never sends'],
];
// one name may appear where it is refused, never where it is read
const EXCEPTIONS = { '.credentials.json': ['workspace.js', 'workspace.ts'] };

let bad = 0;
for (const f of files) {
  const text = readFileSync(f, 'utf8');
  const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
  for (const m of code.matchAll(/(?:from\s+|import\s*\(\s*|require\s*\(\s*)['"]([^'"]+)['"]/g)) {
    const mod = m[1];
    if (!mod.startsWith('.') && !ALLOWED_IMPORTS.has(mod)) {
      console.error(`${relative('.', f)}: imports ${mod}`);
      bad++;
    }
  }
  // from child_process, spawn alone (and its types)
  for (const m of code.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]node:child_process['"]/g)) {
    for (const n of m[1].split(',').map((x) => x.trim()).filter(Boolean)) {
      if (n !== 'spawn' && !n.startsWith('type ')) {
        console.error(`${relative('.', f)}: imports ${n} from node:child_process`);
        bad++;
      }
    }
  }
  for (const [re, what, sites = []] of RULES) {
    const lines = code.split('\n');
    lines.forEach((l, i) => {
      if (re.test(l) && !sites.some(([where, line]) => where.includes(basename(f)) && line.test(l.trim()))) {
        console.error(`${relative('.', f)}:${i + 1}: ${what}: ${l.trim().slice(0, 120)}`);
        bad++;
      }
    });
  }
  for (const [name, where] of Object.entries(EXCEPTIONS)) {
    if (code.includes(name) && !where.includes(basename(f))) {
      console.error(`${relative('.', f)}: names ${name}`);
      bad++;
    }
  }
}
if (bad) {
  console.error(`forbidden: ${bad} finding(s)`);
  process.exit(1);
}
console.log(`forbidden: ${files.length} files clean`);

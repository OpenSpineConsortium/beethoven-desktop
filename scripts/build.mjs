// Builds dist/beethoven/: one folder that is both a Claude Desktop extension (manifest.json at its root,
// packed to dist/beethoven-<version>.mcpb by `--pack`) and a Claude Code plugin (.claude-plugin/ at its
// root; `claude --plugin-dir dist/beethoven`). The server is this repository's TypeScript compiled as it
// stands, with no dependency of any kind; the site profiles go beside it as data.
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'dist', 'beethoven');
const pack = process.argv.includes('--pack');
const bin = (n) => join(ROOT, 'node_modules', '.bin', process.platform === 'win32' ? `${n}.cmd` : n);
const run = (cmd, args) => execFileSync(cmd, args, { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' });
const json = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));

// one version everywhere, an integer one
const pkg = json('package.json');
const manifest = json('bundle/manifest.json');
const plugin = json('plugin/.claude-plugin/plugin.json');
const versionTs = /VERSION = '([^']+)'/.exec(readFileSync(join(ROOT, 'src/version.ts'), 'utf8'))?.[1];
const versions = { 'package.json': pkg.version, 'bundle/manifest.json': manifest.version, 'plugin.json': plugin.version, 'src/version.ts': versionTs };
if (new Set(Object.values(versions)).size !== 1) throw new Error(`versions differ: ${JSON.stringify(versions)}`);
if (!/^\d+\.0\.0$/.test(pkg.version)) throw new Error(`versions are integers (N.0.0), not ${pkg.version}`);

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
run(bin('tsc'), ['-p', 'tsconfig.build.json']);

mkdirSync(join(OUT, 'profiles'));
for (const f of readdirSync(join(ROOT, 'profiles')).filter((f) => f.endsWith('.json'))) {
  JSON.parse(readFileSync(join(ROOT, 'profiles', f), 'utf8'));
  cpSync(join(ROOT, 'profiles', f), join(OUT, 'profiles', f));
}
cpSync(join(ROOT, 'bundle', 'manifest.json'), join(OUT, 'manifest.json'));
cpSync(join(ROOT, 'bundle', 'icon.png'), join(OUT, 'icon.png'));
cpSync(join(ROOT, 'plugin', '.claude-plugin'), join(OUT, '.claude-plugin'), { recursive: true });
cpSync(join(ROOT, 'plugin', 'skills'), join(OUT, 'skills'), { recursive: true });
cpSync(join(ROOT, 'README.md'), join(OUT, 'README.md'));
// the compiled server is ES modules; this file tells Node so, and carries nothing else
writeFileSync(join(OUT, 'package.json'), JSON.stringify({ name: pkg.name, version: pkg.version, private: true, type: 'module' }, null, 2) + '\n');

run(process.execPath, [join(ROOT, 'scripts', 'forbidden.mjs'), join(OUT, 'server')]);

if (pack) {
  run(bin('mcpb'), ['validate', join(OUT, 'manifest.json')]);
  const file = join(ROOT, 'dist', `beethoven-${pkg.version}.mcpb`);
  rmSync(file, { force: true });
  run(bin('mcpb'), ['pack', OUT, file]);
  if (!existsSync(file)) throw new Error('mcpb pack wrote nothing');
  console.log(`packed ${file}`);
}
console.log(`built ${OUT}`);

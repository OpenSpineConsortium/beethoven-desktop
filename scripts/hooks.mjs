// Points git at .githooks, so the gate runs before every push (`npm ci` runs this through `prepare`).
// Outside a git checkout, or with no git, it says so and changes nothing.
import { spawnSync } from 'node:child_process';

const r = spawnSync('git', ['config', 'core.hooksPath', '.githooks'], { encoding: 'utf8' });
if (r.status === 0) console.log('hooks: git runs .githooks/pre-push before every push');
else console.log('hooks: not a git checkout here; nothing set');

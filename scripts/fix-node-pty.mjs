// pnpm extracts node-pty's prebuilt `spawn-helper` without the executable bit, which makes every
// spawn fail with "posix_spawnp failed". Restore the bit after each install.
import { chmodSync, existsSync, readdirSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(join(process.cwd(), 'apps/server/package.json'));
let root;
try {
  root = dirname(realpathSync(require.resolve('node-pty/package.json')));
} catch {
  process.exit(0);
}
for (const dir of ['prebuilds', 'build/Release']) {
  const base = join(root, dir);
  if (!existsSync(base)) continue;
  const candidates = dir === 'prebuilds' ? readdirSync(base).map((d) => join(base, d)) : [base];
  for (const candidate of candidates) {
    const helper = join(candidate, 'spawn-helper');
    if (existsSync(helper)) chmodSync(helper, 0o755);
  }
}

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const entry = resolve(root, 'src/index.js');
const output = resolve(root, '_worker.js');
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));

if (!existsSync(entry)) {
  throw new Error(`missing entry file: ${entry}`);
}

const result = spawnSync('npx', [
  'esbuild',
  entry,
  '--bundle',
  '--format=esm',
  '--platform=browser',
  '--target=es2022',
  '--external:cloudflare:sockets',
  `--outfile=${output}`,
], {
  cwd: root,
  stdio: 'inherit',
});

if (result.status !== 0) {
  process.exit(result.status || 1);
}

const bundle = readFileSync(output, 'utf8');
const banner = `// edgetunnel-v4-core ${pkg.version}\n`;
writeFileSync(output, banner + bundle);

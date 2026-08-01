import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));

// 两个独立 Worker 入口
const TARGETS = [
  { entry: 'src/index-transmission.js', output: '_worker-transmission.js', label: 'transmission' },
  { entry: 'src/index-admin.js',        output: '_worker-admin.js',        label: 'admin' },
];

for (const target of TARGETS) {
  const entry = resolve(root, target.entry);
  const output = resolve(root, target.output);

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
    `--define:__EDGETUNNEL_VERSION__=${JSON.stringify(pkg.version)}`,
    `--outfile=${output}`,
  ], {
    cwd: root,
    stdio: 'inherit',
  });

  if (result.status !== 0) {
    process.exit(result.status || 1);
  }

  const bundle = readFileSync(output, 'utf8');
  const banner = `// edgetunnel-${target.label} ${pkg.version}\n`;
  writeFileSync(output, banner + bundle);

  console.log(`✓ built ${target.output}`);
}

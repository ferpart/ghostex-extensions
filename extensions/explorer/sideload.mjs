#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const { name } = JSON.parse(readFileSync(join(root, 'ghostex-extension.json'), 'utf8'));
const payload = ['ghostex-extension.json', 'icon.svg', 'README.md', 'CHANGELOG.md', 'dist', 'metadata'];

if (!existsSync(join(root, 'dist', 'app.js'))) {
  console.error('dist/ is missing. Run `npm run build` first.');
  process.exit(1);
}

const workDir = mkdtempSync(join(tmpdir(), `ghostex-${name}-sideload-`));
const staged = join(workDir, name);
mkdirSync(staged);
const gx = (...args) => {
  const result = spawnSync('ghostex', args, { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
};

try {
  for (const entry of payload) {
    const source = join(root, entry);
    if (existsSync(source)) cpSync(source, join(staged, entry), { recursive: true });
  }
  gx('extensions', 'install-local', staged);
  gx('extensions', 'state', name, '--set', 'pinned=true');
} finally {
  rmSync(workDir, { force: true, recursive: true });
}

#!/usr/bin/env node
import { cpSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const extensions = readdirSync(join(root, 'extensions'), { withFileTypes: true }).filter((entry) => entry.isDirectory());

for (const { name } of extensions) {
  const extension = join(root, 'extensions', name);
  rmSync(join(extension, 'src', 'shared'), { force: true, recursive: true });
  cpSync(join(root, 'shared'), join(extension, 'src', 'shared'), { recursive: true });
  for (const file of ['build.mjs', 'sideload.mjs']) {
    cpSync(join(root, 'tooling', 'template', file), join(extension, file));
  }
  console.log(`synced ${name}`);
}

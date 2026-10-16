#!/usr/bin/env node
import { build } from 'esbuild';
import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const dist = join(root, 'dist');
const monacoWorker = 'node_modules/monaco-editor/esm/vs/editor/editor.worker.js';

rmSync(dist, { force: true, recursive: true });
mkdirSync(dist, { recursive: true });

await build({
  absWorkingDir: root,
  entryPoints: {
    app: 'src/main.jsx',
    ...(existsSync(join(root, monacoWorker)) ? { 'editor.worker': `./${monacoWorker}` } : {}),
  },
  outdir: 'dist',
  bundle: true,
  format: 'esm',
  splitting: true,
  platform: 'browser',
  target: ['chrome120'],
  jsx: 'automatic',
  jsxImportSource: 'preact',
  minify: true,
  loader: { '.ttf': 'file' },
  charset: 'utf8',
  logLevel: 'warning',
});

copyFileSync(join(root, 'src', 'index.html'), join(dist, 'index.html'));

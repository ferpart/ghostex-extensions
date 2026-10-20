import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { headContentCommand, parseHeadContent } from './git-head.js';

const root = mkdtempSync(join(tmpdir(), 'git-head-selftest-'));
const sh = (command, cwd = root) => execSync(command, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
const git = (cwd) => sh('git init -q && git add . && git -c user.email=t@t -c user.name=t commit -qm init', cwd);

mkdirSync(join(root, 'repo/src'), { recursive: true });
writeFileSync(join(root, 'repo/src/a.js'), 'committed\n');
writeFileSync(join(root, 'repo/top.txt'), 'top\n');
git(join(root, 'repo'));
writeFileSync(join(root, 'repo/src/a.js'), 'edited\n');
writeFileSync(join(root, 'repo/src/new.js'), 'new\n');
writeFileSync(join(root, 'loose.txt'), 'loose\n');

const head = (path, cwd = root) => parseHeadContent(sh(headContentCommand(path), cwd));

assert.deepEqual(head('repo/src/a.js'), { inRepo: true, content: 'committed\n' });
assert.deepEqual(head('repo/top.txt'), { inRepo: true, content: 'top\n' });
assert.deepEqual(head('repo/src/new.js'), { inRepo: true, content: '' });
assert.deepEqual(head('loose.txt'), { inRepo: false, content: '' });
assert.deepEqual(head('src/a.js', join(root, 'repo')), { inRepo: true, content: 'committed\n' });
assert.deepEqual(head('a.js', join(root, 'repo/src')), { inRepo: true, content: 'committed\n' });
assert.deepEqual(head("it's.txt", join(root, 'repo')), { inRepo: true, content: '' });

console.log('git-head selftest ok');

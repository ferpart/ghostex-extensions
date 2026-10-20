import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync, chmodSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { posixCommand } from './posix.js';

const script = [
  `[ -n "x" ] || { echo never; exit 1; }`,
  `n=$((2 + 3)); if [ "$n" -eq 5 ]; then printf '%s\\n' "five it's \\"ok\\" ünï"; fi`,
  `for f in a b; do printf %s "$f"; done; echo`,
].join('\n');
const expected = `five it's "ok" ünï\nab\n`;

const shells = ['/bin/sh', '/bin/zsh', 'fish', 'bash'].filter((shell) => spawnSync(shell, ['-c', 'true']).status === 0);
for (const shell of shells) {
  const result = spawnSync(shell, ['-lc', posixCommand(script)], { encoding: 'utf8' });
  assert.equal(result.stderr, '', `${shell} stderr`);
  assert.equal(result.stdout, expected, `${shell} stdout`);
}

const dir = mkdtempSync(join(tmpdir(), 'posix-selftest-'));
try {
  const target = join(dir, 'run.sh');
  writeFileSync(target, 'old');
  chmodSync(target, 0o755);
  const content = 'é'.repeat(400_000);
  const { writeFileCommands } = await import('./posix.js');
  for (const command of writeFileCommands(target, content)) {
    const result = spawnSync(shells.at(-1), ['-lc', posixCommand(command)], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  }
  assert.equal(readFileSync(target, 'utf8'), content);
  assert.equal(statSync(target).mode & 0o777, 0o755);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
console.log(`posix selftest ok (${shells.join(', ')})`);

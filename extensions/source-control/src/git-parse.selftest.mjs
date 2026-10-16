import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BRANCH_LIST_FORMAT, changeListArgs, parseBranchList, parseChangeList, parseNumstat, parseStatus, sumLines } from './git-parse.js';

const status = parseStatus(
  [
    '# branch.oid 1111111111111111111111111111111111111111',
    '# branch.head feature/x',
    '# branch.upstream origin/feature/x',
    '# branch.ab +2 -3',
    '1 M. N... 100644 100644 100644 aaa bbb src/a file.js',
    '1 .D N... 100644 100644 000000 aaa bbb gone.txt',
    '1 AM N... 000000 100644 100644 000 bbb new.js',
    '2 R. N... 100644 100644 100644 aaa bbb R100 renamed.js',
    'old name.js',
    'u UU N... 100644 100644 100644 100644 a b c conflict.js',
    '? untracked dir/file.md',
    '',
  ].join('\0')
);
assert.deepEqual(status.branch, { oid: '1111111111111111111111111111111111111111', head: 'feature/x', upstream: 'origin/feature/x', ahead: 2, behind: 3 });
assert.deepEqual(status.staged, [
  { path: 'src/a file.js', oldPath: undefined, status: 'M' },
  { path: 'new.js', oldPath: undefined, status: 'A' },
  { path: 'renamed.js', oldPath: 'old name.js', status: 'R' },
]);
assert.deepEqual(status.unstaged, [
  { path: 'gone.txt', status: 'D' },
  { path: 'new.js', status: 'M' },
  { path: 'conflict.js', status: '!', conflict: true },
  { path: 'untracked dir/file.md', status: 'U', untracked: true },
]);
assert.equal(parseStatus('# branch.oid (initial)\0# branch.head (detached)\0').branch.head, null);

const numstat = parseNumstat('3\t1\ta.js\0-\t-\timg.png\0' + '2\t0\t\0old.js\0new.js\0');
assert.deepEqual(numstat.get('a.js'), { added: 3, removed: 1, binary: false });
assert.deepEqual(numstat.get('img.png'), { added: 0, removed: 0, binary: true });
assert.deepEqual(numstat.get('new.js'), { added: 2, removed: 0, binary: false });

assert.deepEqual(
  parseBranchList(
    [
      'refs/heads/main\tmain\t',
      'refs/heads/feature/x\tfeature/x\t',
      'refs/remotes/origin/HEAD\torigin\trefs/remotes/origin/main',
      'refs/remotes/origin/main\torigin/main\t',
      'refs/remotes/upstream/HEAD\tupstream/HEAD\t',
      '',
    ].join('\n')
  ),
  [
    { name: 'main', remote: false },
    { name: 'feature/x', remote: false },
    { name: 'origin/main', remote: true },
  ]
);

const repo = mkdtempSync(join(tmpdir(), 'gx-git-parse-'));
try {
  const sh = (command) => execSync(command, { cwd: repo, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });
  const git = (command) => sh(`git ${command}`);
  git('init -q -b main');
  writeFileSync(join(repo, 'keep.txt'), 'one\ntwo\nthree\nfour\nfive\nsix\n');
  writeFileSync(join(repo, 'drop.txt'), 'x\n');
  git('add -A');
  git('commit -q -m base');
  git('mv keep.txt moved.txt');
  writeFileSync(join(repo, 'moved.txt'), 'one\ntwo\nthree\nfour\nfive\nsix\nseven\n');
  git('rm -q drop.txt');
  writeFileSync(join(repo, 'with space.txt'), 'a\nb\n');
  git('add -A');
  git('commit -q -m change');

  const changes = parseChangeList(sh(changeListArgs('HEAD~1', 'HEAD')));
  assert.deepEqual(changes, [
    { path: 'drop.txt', oldPath: undefined, status: 'D', added: 0, removed: 1, binary: false },
    { path: 'moved.txt', oldPath: 'keep.txt', status: 'R', added: 1, removed: 0, binary: false },
    { path: 'with space.txt', oldPath: undefined, status: 'A', added: 2, removed: 0, binary: false },
  ]);
  assert.deepEqual(sumLines(changes), { added: 3, removed: 1 });
  assert.equal(parseChangeList(sh(changeListArgs(null, 'HEAD~1'))).length, 2);

  git('update-ref refs/remotes/origin/main HEAD~1');
  git('symbolic-ref refs/remotes/origin/HEAD refs/remotes/origin/main');
  git('branch topic HEAD~1');
  const branches = parseBranchList(git(`for-each-ref '--format=${BRANCH_LIST_FORMAT}' refs/heads refs/remotes`));
  assert.deepEqual(branches, [
    { name: 'main', remote: false },
    { name: 'topic', remote: false },
    { name: 'origin/main', remote: true },
  ]);

  writeFileSync(join(repo, 'moved.txt'), 'changed\n');
  writeFileSync(join(repo, 'fresh.txt'), 'new\n');
  const live = parseStatus(git('status --porcelain=v2 -z --branch --untracked-files=all'));
  assert.equal(live.branch.head, 'main');
  assert.deepEqual(live.unstaged.map((entry) => `${entry.status} ${entry.path}`), ['M moved.txt', 'U fresh.txt']);
} finally {
  rmSync(repo, { recursive: true, force: true });
}

console.log('git-parse selftest passed');

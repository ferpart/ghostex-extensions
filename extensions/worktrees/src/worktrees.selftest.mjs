import assert from 'node:assert/strict';
import {
  blockers,
  canDelete,
  detailsScript,
  githubSlugOf,
  newestPullRequestByBranch,
  parseBatchDetails,
  parseDetails,
  parseWorktreeList,
  pullRequestState,
  repoNameOf,
} from './worktrees.js';

const porcelain = `worktree /dev/repo
HEAD 1111111111111111111111111111111111111111
branch refs/heads/main

worktree /dev/repo-feat
HEAD 2222222222222222222222222222222222222222
branch refs/heads/feat/login

worktree /dev/repo-detached
HEAD 3333333333333333333333333333333333333333
detached

worktree /dev/repo-gone
HEAD 4444444444444444444444444444444444444444
branch refs/heads/old
prunable gitdir file points to non-existent location
`;
const list = parseWorktreeList(porcelain);
assert.deepEqual(
  list.map((entry) => [entry.path, entry.branch, entry.isMain, entry.detached, entry.prunable]),
  [
    ['/dev/repo', 'main', true, false, false],
    ['/dev/repo-feat', 'feat/login', false, false, false],
    ['/dev/repo-detached', null, false, true, false],
    ['/dev/repo-gone', 'old', false, false, true],
  ]
);
assert.deepEqual(parseWorktreeList('worktree /dev/bare.git\nbare\n\nworktree /dev/wt\nbranch refs/heads/x\n').map((e) => e.path), ['/dev/wt']);
assert.deepEqual(parseWorktreeList(''), []);

assert.equal(githubSlugOf('git@github.com:brightcove/repo.git'), 'brightcove/repo');
assert.equal(githubSlugOf('https://github.com/ferpart/ghostex-extensions\n'), 'ferpart/ghostex-extensions');
assert.equal(githubSlugOf('ssh://git@github.com/o/r.git'), 'o/r');
assert.equal(githubSlugOf('https://gitlab.com/o/r.git'), null);
assert.equal(githubSlugOf(''), null);

const pr = (number, headRefName, state, extra = {}) => ({ number, headRefName, state, isDraft: false, ...extra });
const matched = newestPullRequestByBranch([
  pr(3, 'feat/login', 'CLOSED'),
  pr(9, 'feat/login', 'OPEN', { isDraft: true }),
  pr(5, 'feat/login', 'MERGED'),
  pr(11, 'fork-branch', 'MERGED', { isCrossRepository: true }),
  pr(2, 'old', 'MERGED'),
]);
assert.equal(matched.get('feat/login').number, 9);
assert.equal(matched.get('fork-branch'), undefined);
assert.equal(matched.get('old').number, 2);

assert.equal(pullRequestState(undefined), 'none');
assert.equal(pullRequestState(pr(1, 'a', 'OPEN')), 'open');
assert.equal(pullRequestState(pr(1, 'a', 'OPEN', { isDraft: true })), 'draft');
assert.equal(pullRequestState(pr(1, 'a', 'MERGED')), 'merged');
assert.equal(pullRequestState(pr(1, 'a', 'CLOSED')), 'closed');

const base = { isMain: false, exists: true, dirty: 0, unpushed: 0, pr: pr(1, 'a', 'MERGED') };
assert.equal(canDelete(base), true);
assert.equal(canDelete({ ...base, pr: pr(1, 'a', 'CLOSED') }), true);
assert.equal(canDelete({ ...base, isMain: true }), false);
assert.equal(canDelete({ ...base, exists: false }), false);
assert.equal(canDelete({ ...base, pr: pr(1, 'a', 'OPEN') }), false);
assert.equal(canDelete({ ...base, pr: pr(1, 'a', 'OPEN', { isDraft: true }) }), false);
assert.equal(canDelete({ ...base, pr: undefined }), false);
assert.equal(canDelete({ ...base, dirty: 2 }), false);
assert.equal(canDelete({ ...base, dirty: null }), false);
assert.equal(canDelete({ ...base, unpushed: 1 }), false);
assert.equal(canDelete({ ...base, unpushed: null }), false);
assert.deepEqual(blockers({ ...base, dirty: 2, unpushed: 1 }), ['2 uncommitted', '1 unpushed']);
assert.deepEqual(blockers(base), []);

assert.deepEqual(parseDetails('dirty=3\nunpushed=2\ncommitted=1700000000\n'), { exists: true, dirty: 3, unpushed: 2, committedAt: 1700000000000 });
assert.equal(parseDetails('dirty=0\nunpushed=4\ncommitted=1\ninpr=1\n').unpushed, 0);
assert.equal(parseDetails('dirty=0\nunpushed=\ncommitted=\n').unpushed, null);
assert.equal(parseDetails('missing=1\n').exists, false);

const script = detailsScript([{ path: "/a b/it's", headCommitOfPr: 'abc' }, { path: '/c' }]);
assert.match(script, /cd '\/a b\/it'\\''s'/);
assert.equal(script.split('echo @@').length, 3);
assert.equal(script.includes("merge-base --is-ancestor HEAD 'abc'"), true);
assert.deepEqual(
  parseBatchDetails('@@\ndirty=1\nunpushed=0\ncommitted=60\n@@\nmissing=1\n').map((d) => [d.exists, d.dirty]),
  [[true, 1], [false, null]]
);
assert.equal(repoNameOf('/dev/repo/.git'), 'repo');
assert.equal(repoNameOf('/dev/repo.git/'), 'repo.git');

console.log('worktrees selftest ok');

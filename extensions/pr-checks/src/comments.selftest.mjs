import assert from 'node:assert/strict';
import { audienceCounts, buildPRCommentsResolutionPrompt, filterByAudience, groupComments, groupRoot, isBotComment, mapPullRequestComments } from './comments.js';

const bot = (author, isBot = false) => isBotComment({ author, isBot });
assert.equal(bot('octocat'), false);
assert.equal(bot('dependabot[bot]'), true);
assert.equal(bot('cursor', true), true, 'the GraphQL Bot type wins');
assert.equal(bot('coderabbitai'), true);
assert.equal(bot('brightcove-guardian'), false);
assert.equal(bot('release-automation'), true);
assert.equal(bot('github-actions'), true);
assert.equal(bot('qodo-merge-pro'), true);
assert.equal(bot('robert'), false);

const node = (id, author, typename, createdAt, extra = {}) => ({
  id: `N${id}`,
  databaseId: id,
  author: { __typename: typename, login: author, avatarUrl: `https://a/${author}` },
  body: `body ${id}`,
  bodyHTML: `<p>body ${id}</p>`,
  createdAt,
  url: `https://github.com/o/r/pull/1#c${id}`,
  reactionGroups: [
    { content: 'THUMBS_UP', viewerHasReacted: true, reactors: { totalCount: 2 } },
    { content: 'EYES', viewerHasReacted: false, reactors: { totalCount: 0 } },
  ],
  ...extra,
});

const comments = mapPullRequestComments({
  comments: { nodes: [node(1, 'alice', 'User', '2026-01-01T00:00:00Z'), node(2, 'cursor', 'Bot', '2026-01-03T00:00:00Z')] },
  reviews: { nodes: [node(3, 'bob', 'User', '2026-01-02T00:00:00Z'), node(4, 'bob', 'User', '2026-01-02T01:00:00Z', { body: '  ' })] },
  reviewThreads: {
    nodes: [
      {
        id: 'T1',
        isResolved: false,
        line: null,
        startLine: null,
        originalLine: 9,
        originalStartLine: 7,
        comments: { nodes: [node(5, 'bob', 'User', '2026-01-04T00:00:00Z', { path: 'a.js' }), node(6, 'alice', 'User', '2026-01-05T00:00:00Z', { path: 'a.js' })] },
      },
    ],
  },
});
assert.deepEqual(comments.map((comment) => comment.id), [1, 3, 2, 5, 6], 'sorted by time, empty review bodies dropped');
assert.deepEqual(comments[0].reactions, [{ content: 'THUMBS_UP', count: 2, viewerHasReacted: true }]);
assert.equal(comments[3].isOutdated, true);
assert.equal(comments[3].line, 9);
assert.equal(comments[3].startLine, 7);

const groups = groupComments(comments);
assert.equal(groups.length, 4);
assert.equal(groups[3].kind, 'thread');
assert.equal(groups[3].replies.length, 1);
assert.deepEqual(audienceCounts(groups, groupRoot), { all: 4, human: 3, bot: 1 });
assert.deepEqual(filterByAudience(groups, 'bot', groupRoot).map((group) => groupRoot(group).author), ['cursor']);
assert.equal(filterByAudience(groups, 'human', groupRoot).length, 3);

const prompt = buildPRCommentsResolutionPrompt({
  reviewNumber: 1,
  reviewTitle: 'feat: "x"',
  reviewUrl: 'https://github.com/o/r/pull/1',
  groups: [groups[0], groups[3]],
  worktreePath: '/w',
});
assert.ok(prompt.startsWith('Inspect and fix the selected review feedback for PR #1.'));
assert.ok(prompt.includes('- Review title: "feat: \\"x\\""'));
assert.ok(prompt.includes('- Selected comment groups: 2'));
assert.ok(prompt.includes('- Host-resolvable selected threads: 1'));
const payload = JSON.parse(prompt.split('Selected comment data JSON:\n')[1].split('\n\nRules:')[0]);
assert.equal(payload.review.worktreePath, '/w');
assert.equal(payload.selectedCommentGroups[0].kind, 'standalone');
assert.equal(payload.selectedCommentGroups[1].isHostResolvable, true);
assert.equal(payload.hostResolvableThreads[0].replies[0].author, 'alice');
assert.equal(payload.hostResolvableThreads[0].path, 'a.js');
assert.ok(!/orca/i.test(prompt));

console.log('comments selftest: ok');

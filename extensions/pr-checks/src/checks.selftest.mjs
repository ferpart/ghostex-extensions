import assert from 'node:assert/strict';
import {
  badgeLines,
  buildFixBrokenChecksPrompt,
  checkKey,
  mapRollupContexts,
  mergeBlocker,
  summarizeChecks,
  summaryText,
  truncateLogTailForPrompt,
} from './checks.js';

const checks = mapRollupContexts([
  { __typename: 'CheckRun', databaseId: 11, name: 'build', status: 'COMPLETED', conclusion: 'SUCCESS', detailsUrl: 'https://github.com/o/r/actions/runs/5/job/11', checkSuite: { app: { slug: 'github-actions' }, workflowRun: { databaseId: 5 } } },
  { __typename: 'CheckRun', databaseId: 12, name: 'test', status: 'COMPLETED', conclusion: 'FAILURE', detailsUrl: 'https://github.com/o/r/actions/runs/5/job/12', checkSuite: { app: { slug: 'github-actions' }, workflowRun: { databaseId: 5 } } },
  { __typename: 'CheckRun', databaseId: 13, name: 'lint', status: 'IN_PROGRESS', conclusion: null, checkSuite: null },
  { __typename: 'CheckRun', databaseId: 14, name: 'docs', status: 'COMPLETED', conclusion: 'SKIPPED' },
  { __typename: 'CheckRun', databaseId: 15, name: 'old', status: 'COMPLETED', conclusion: 'STARTUP_FAILURE' },
  { __typename: 'StatusContext', context: 'jenkins', state: 'PENDING', targetUrl: 'https://ci/1' },
  { __typename: 'StatusContext', context: 'build', state: 'FAILURE' },
]);

assert.equal(checks.length, 6, 'a status context with a check run name is dropped');
assert.deepEqual(
  checks.map((check) => check.conclusion),
  ['success', 'failure', 'pending', 'skipped', 'failure', 'pending']
);
assert.equal(checks[1].workflowRunId, 5);
assert.equal(checks[1].isActions, true);
assert.equal(checks[2].isActions, false);

const summary = summarizeChecks(checks);
assert.deepEqual(summary, { passing: 1, failing: 2, pending: 2, other: 1, total: 6 });
assert.equal(summaryText(summary), '2 failing, 2 pending, 1 passing, 1 skipped or neutral');
assert.deepEqual(badgeLines(summary), ['✗2 ●2']);
assert.deepEqual(badgeLines(summarizeChecks([checks[0]])), ['✓1']);
assert.deepEqual(badgeLines(summarizeChecks([])), []);
assert.equal(summaryText(summarizeChecks([checks[0], checks[0]])), '2 passing');

const longLog = Array.from({ length: 400 }, (_, index) => `line ${index}`).join('\r\n');
const tail = truncateLogTailForPrompt(longLog);
assert.equal(tail.split('\n').length, 150);
assert.ok(tail.endsWith('line 399'));
assert.ok(!tail.includes('\r'));

const prompt = buildFixBrokenChecksPrompt({
  reviewNumber: 7,
  reviewTitle: 'feat: thing',
  reviewUrl: 'https://github.com/o/r/pull/7',
  checks,
  logsByCheckKey: { [checkKey(checks[1])]: { text: 'boom\nassert failed' }, [checkKey(checks[4])]: { error: 'HTTP 404' } },
});
assert.ok(prompt.startsWith('Investigate the broken checks for PR #7'));
const brokenData = JSON.parse(prompt.split('Broken check data:\n')[1].split('\n\nBefore making changes')[0]);
assert.deepEqual(brokenData.map((check) => check.name), ['test', 'old']);
assert.equal(brokenData[0].logTail, 'boom\nassert failed');
assert.equal(brokenData[0].status, 'Failed');
assert.match(brokenData[1].logExcerptContext, /could not be loaded/);
assert.match(buildFixBrokenChecksPrompt({ reviewNumber: 1, reviewTitle: '', reviewUrl: '', checks: [] }), /No failing check is currently listed/);

const openPr = { state: 'OPEN', isDraft: false, mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN', reviewDecision: '', baseRefName: 'main' };
assert.equal(mergeBlocker(openPr), null);
assert.equal(mergeBlocker({ ...openPr, mergeStateStatus: 'UNSTABLE' }), null);
assert.match(mergeBlocker({ ...openPr, isDraft: true }), /draft/);
assert.match(mergeBlocker({ ...openPr, mergeable: 'CONFLICTING', mergeStateStatus: 'DIRTY' }), /conflicts.*main/);
assert.match(mergeBlocker({ ...openPr, reviewDecision: 'REVIEW_REQUIRED', mergeStateStatus: 'BLOCKED' }), /approving review/);
assert.match(mergeBlocker({ ...openPr, state: 'MERGED' }), /merged/);

console.log('checks selftest: ok');

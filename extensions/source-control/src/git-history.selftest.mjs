import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildColorMap, buildGraphRows, laneIndex, logCommand, mergeParentLaneIndex, nodeColor, parseLog } from './git-history.js';

const commit = (id, parentIds, references = []) => ({ id, parentIds, references });
const main = { id: 'refs/heads/main', name: 'main', category: 'branches' };
const rows = buildGraphRows(
  [commit('M', ['A', 'B'], [main]), commit('B', ['C']), commit('A', ['C']), commit('C', [])],
  buildColorMap({ currentRef: 'refs/heads/main' }),
  'M'
);
const lanes = (nodes) => nodes.map((node) => `${node.id}:${node.color}`);
assert.deepEqual(rows.map((row) => lanes(row.outputLanes)), [
  ['A:ref', 'B:lane-1'],
  ['A:ref', 'C:lane-1'],
  ['C:ref', 'C:lane-1'],
  [],
]);
assert.deepEqual(rows.map(laneIndex), [0, 1, 0, 0]);
assert.deepEqual(rows.map(nodeColor), ['ref', 'lane-1', 'ref', 'ref']);
assert.equal(mergeParentLaneIndex(rows[0], 'B'), 1);
assert.equal(rows[0].isHead, true);
assert.equal(rows[0].item.references[0].color, 'ref');

const linear = buildGraphRows([commit('3', ['2']), commit('2', ['1']), commit('1', [])]);
assert.deepEqual(linear.map((row) => lanes(row.outputLanes)), [['2:lane-1'], ['1:lane-1'], []]);

const repo = mkdtempSync(join(tmpdir(), 'gx-git-history-'));
try {
  const env = { ...process.env, GIT_AUTHOR_NAME: 'Ada', GIT_AUTHOR_EMAIL: 'a@a', GIT_COMMITTER_NAME: 'Ada', GIT_COMMITTER_EMAIL: 'a@a' };
  const sh = (command) => execSync(command, { cwd: repo, encoding: 'utf8', env });
  sh('git init -q -b main');
  writeFileSync(join(repo, 'a.txt'), '1\n');
  sh('git add -A && git commit -q -m root && git tag v1');
  sh('git switch -q -c side');
  writeFileSync(join(repo, 'b.txt'), '1\n');
  sh('git add -A && git commit -q -m "side work"');
  sh('git switch -q main');
  writeFileSync(join(repo, 'a.txt'), '2\n');
  sh('git add -A && git commit -q -m "main work" -m "body line"');
  sh('git merge -q --no-edit --no-ff side');

  const items = parseLog(sh(logCommand(10)));
  assert.equal(items.length, 4);
  assert.equal(items[0].parentIds.length, 2);
  assert.equal(items[0].subject, "Merge branch 'side'");
  assert.deepEqual(items[0].references.map((ref) => ref.name), ['main']);
  assert.equal(items.at(-1).references[0].id, 'refs/tags/v1');
  assert.equal(items.find((item) => item.subject === 'main work').message, 'main work\n\nbody line');
  assert.equal(items[0].author, 'Ada');
  assert.equal(parseLog(sh(logCommand(1))).length, 2);

  const graph = buildGraphRows(items, buildColorMap({ currentRef: 'refs/heads/main' }), items[0].id);
  assert.equal(graph.at(-1).outputLanes.length, 0);
  assert.equal(Math.max(...graph.map(laneIndex)), 1);
} finally {
  rmSync(repo, { recursive: true, force: true });
}

console.log('git-history selftest passed');

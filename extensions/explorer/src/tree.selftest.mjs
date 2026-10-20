import assert from 'node:assert/strict';
import { ancestorsOf, buildTree, parseGitStatus, splitNul, visibleRows } from './tree.js';

assert.deepEqual(splitNul('a\0b\0'), ['a', 'b']);
assert.deepEqual(splitNul('a\0b\0trunc'), ['a', 'b']);
assert.deepEqual(ancestorsOf('a/b/c.js'), ['a/b', 'a']);

const tree = buildTree(['README.md', 'src/b.js', 'src/a.js', '.github/ci.yml', 'Dockerfile', 'src/lib/x.js', 'docker_helper.sh', 'file10', 'file9', 'src/a.js']);
assert.deepEqual(
  tree.children.map((node) => node.name),
  ['.github', 'src', 'docker_helper.sh', 'Dockerfile', 'file9', 'file10', 'README.md']
);
const src = tree.children[1];
assert.deepEqual(src.children.map((node) => node.name), ['lib', 'a.js', 'b.js']);

assert.deepEqual(visibleRows(tree, new Set()).map((row) => row.node.path).slice(0, 3), ['.github', 'src', 'docker_helper.sh']);
const expanded = visibleRows(tree, new Set(['src', 'src/lib']));
assert.deepEqual(
  expanded.slice(1, 6).map((row) => [row.node.path, row.depth]),
  [['src', 0], ['src/lib', 1], ['src/lib/x.js', 2], ['src/a.js', 1], ['src/b.js', 1]]
);

const status = parseGitStatus(
  ' M src/lib/x.js\0?? src/new.js\0R  src/renamed.js\0src/old.js\0D  gone.txt\0UU src/conflict.js\0',
  ''
);
assert.equal(status.files.get('src/lib/x.js'), 'modified');
assert.equal(status.files.get('src/new.js'), 'untracked');
assert.equal(status.files.get('src/renamed.js'), 'renamed');
assert.equal(status.files.has('src/old.js'), false);
assert.equal(status.files.get('gone.txt'), 'deleted');
assert.equal(status.dirs.get('src/lib'), 'modified');
assert.equal(status.dirs.get('src'), 'conflict');

const nested = parseGitStatus(' M pkg/a.js\0 M other/b.js\0', 'pkg/');
assert.deepEqual([...nested.files], [['a.js', 'modified']]);

console.log('tree selftest ok');

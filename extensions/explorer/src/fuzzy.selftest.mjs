import assert from 'node:assert/strict';
import { rankPaths, scoreTerm } from './fuzzy.js';

assert.equal(scoreTerm('xyz', 'src/main.js', 'main.js'), null);
assert.ok(scoreTerm('mjs', 'src/main.js', 'main.js') !== null);

const paths = ['src/domain/model.js', 'src/main.jsx', 'docs/main-guide.md', 'README.md', 'src/shared/bridge.js'];
assert.equal(rankPaths('main', paths).results[0].path, 'src/main.jsx');
assert.equal(rankPaths('brdg', paths).results[0].path, 'src/shared/bridge.js');
assert.deepEqual(rankPaths('src main', paths).results.map((r) => r.path), ['src/main.jsx', 'src/domain/model.js']);
assert.deepEqual(rankPaths('docs main', paths).results.map((r) => r.path), ['docs/main-guide.md']);
assert.equal(rankPaths('README', paths).results[0].path, 'README.md');
assert.deepEqual(rankPaths('   ', paths), { results: [], total: 0 });
assert.equal(rankPaths('s', paths, 2).results.length, 2);
assert.equal(rankPaths('s', paths, 2).total, 4);

const many = Array.from({ length: 20000 }, (_, i) => `pkg${i % 50}/dir${i % 300}/file${i}.ts`);
const started = performance.now();
rankPaths('dir12 file99', many);
assert.ok(performance.now() - started < 500, 'ranking 20k paths should stay under 500 ms');

console.log('fuzzy selftest ok');

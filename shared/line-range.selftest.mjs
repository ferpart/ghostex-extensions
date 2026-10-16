import assert from 'node:assert/strict';
import { edgeScrollStep, orderLineRange } from './line-range.js';

assert.deepEqual(orderLineRange(3, 9), { startLine: 3, endLine: 9 });
assert.deepEqual(orderLineRange(9, 3), { startLine: 3, endLine: 9 });
assert.deepEqual(orderLineRange(5, 5), { startLine: 5, endLine: 5 });

assert.equal(edgeScrollStep(100, 500, 300), 0);
assert.ok(edgeScrollStep(100, 500, 110) < 0);
assert.ok(edgeScrollStep(100, 500, 490) > 0);
assert.ok(edgeScrollStep(100, 500, 600) > edgeScrollStep(100, 500, 480));
assert.equal(edgeScrollStep(100, 500, 5000), 32);
assert.equal(edgeScrollStep(100, 500, -5000), -32);
console.log('line-range selftest ok');

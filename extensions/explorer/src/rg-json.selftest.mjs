import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseRgJson, rgCommand } from './rg-json.js';

const match = (path, line, text, submatches) =>
  JSON.stringify({ type: 'match', data: { path: { text: path }, lines: { text }, line_number: line, submatches } });

const output = [
  JSON.stringify({ type: 'begin', data: { path: { text: './a.js' } } }),
  match('./a.js', 3, 'const héllo = hello;\n', [{ match: { text: 'hello' }, start: 15, end: 20 }]),
  match('./a.js', 9, 'hello()\n', [{ match: { text: 'hello' }, start: 0, end: 5 }]),
  match('./dir/b.md', 1, '# hello\n', [{ match: { text: 'hello' }, start: 2, end: 7 }]),
  JSON.stringify({ type: 'match', data: { path: { bytes: 'AAE=' }, lines: { text: 'x' }, line_number: 1, submatches: [] } }),
  '{"type":"exit","code":0}',
].join('\n');

const parsed = parseRgJson(output);
assert.equal(parsed.totalMatches, 3);
assert.equal(parsed.truncated, false);
assert.equal(parsed.exitCode, 0);
assert.deepEqual(parsed.files.map((file) => file.path), ['a.js', 'dir/b.md']);
assert.deepEqual(parsed.files[0].matches[0], { line: 3, text: 'const héllo = hello;', ranges: [[14, 19]] });

const limited = parseRgJson(output, 2);
assert.equal(limited.totalMatches, 2);
assert.equal(limited.truncated, true);

const cut = parseRgJson(output.split('\n').slice(0, 3).join('\n') + '\n{"type":"mat');
assert.equal(cut.truncated, true);
assert.equal(cut.totalMatches, 2);

assert.equal(parseRgJson('{"type":"exit","code":1}\n').exitCode, 1);

const dir = mkdtempSync(join(tmpdir(), 'rg-selftest-'));
writeFileSync(join(dir, 'one.txt'), "it's Hello\nhello world\n");
const run = (query, options) => parseRgJson(execSync(rgCommand(query, options), { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
assert.equal(run("it's", {}).totalMatches, 1);
assert.equal(run('hello', {}).totalMatches, 2);
assert.equal(run('hello', { caseSensitive: true }).totalMatches, 1);
assert.equal(run('hell', { wholeWord: true }).totalMatches, 0);
assert.equal(run('h.llo', {}).totalMatches, 0);
assert.equal(run('h.llo', { useRegex: true }).totalMatches, 2);
assert.equal(run('(', { useRegex: true }).exitCode, 2);

console.log('rg-json selftest ok');

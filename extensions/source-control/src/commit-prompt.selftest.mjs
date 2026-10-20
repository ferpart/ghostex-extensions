import assert from 'node:assert/strict';
import { agentArgs, buildCommitPrompt, cleanGeneratedMessage, truncateDiffForPrompt } from './commit-prompt.js';

const prompt = buildCommitPrompt('diff --git a/x b/x\n+$& literal');
assert.match(prompt, /^You are generating a single git commit message\./);
assert.ok(prompt.includes('```diff\ndiff --git a/x b/x\n+$& literal\n```'));
assert.ok(!prompt.includes('{{DIFF}}'));

const small = 'diff --git a/a b/a\n+1\n';
assert.equal(truncateDiffForPrompt(small, 1000), small);

const huge = `diff --git a/big b/big\n${'+generated line\n'.repeat(500)}`;
const tiny = 'diff --git a/small b/small\n+keep me\n';
const truncated = truncateDiffForPrompt(`${huge}\n${tiny}`, 1000);
assert.ok(truncated.length <= 1000);
assert.ok(truncated.includes(tiny), 'a small file keeps its full diff');
assert.match(truncated, /\.\.\.\(diff truncated, \d+ bytes omitted\)/);
assert.ok(!/\+generated li(?!ne)/.test(truncated), 'the clip lands on a line boundary');

assert.equal(cleanGeneratedMessage('```\nfeat: add x\n\nbody\n```'), 'feat: add x\n\nbody');
assert.equal(cleanGeneratedMessage('Generating...\r\nfix: y\r\n'), 'fix: y');
assert.equal(cleanGeneratedMessage('<think>hmm</think>\n- docs: z'), 'docs: z');

assert.deepEqual(agentArgs('claude', ''), ['claude', '-p', '--output-format', 'text', '--permission-mode', 'plan']);
assert.deepEqual(agentArgs('claude', 'haiku').slice(4, 6), ['--model', 'haiku']);
assert.deepEqual(agentArgs('codex', 'gpt-5.5'), ['codex', 'exec', '--ephemeral', '--skip-git-repo-check', '-s', 'read-only', '--model', 'gpt-5.5']);

console.log('commit-prompt selftest passed');

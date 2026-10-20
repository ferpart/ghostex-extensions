const BASE_PROMPT = `You are generating a single git commit message.
Read the staged diff below and produce the message.

Rules:
- First line: imperative mood, <= 72 chars, no trailing period.
- Optional body: blank line, then wrapped at 72 chars explaining WHY.
- Output ONLY the commit message - no preamble, no code fences, no quotes.
- Do not include "Co-authored-by" or other git trailers.

Staged diff:
\`\`\`diff
{{DIFF}}
\`\`\`
`;

export const STAGED_DIFF_BYTE_BUDGET = 200_000;

export function buildCommitPrompt(diff) {
  return BASE_PROMPT.replace('{{DIFF}}', () => truncateDiffForPrompt(diff));
}

function splitDiffIntoFileSections(diff) {
  const boundary = '\ndiff --git ';
  const sections = [];
  let start = 0;
  let next = diff.indexOf(boundary);
  while (next !== -1) {
    sections.push(diff.slice(start, next + 1));
    start = next + 1;
    next = diff.indexOf(boundary, start);
  }
  sections.push(diff.slice(start));
  return sections;
}

function clipSectionOnLineBoundary(section, limit) {
  if (section.length <= limit) return section;
  if (limit <= 0) return '';
  const markerFor = (omitted) => `\n...(diff truncated, ${omitted} bytes omitted)\n`;
  let marker = markerFor(section.length);
  if (marker.length >= limit) return marker.slice(0, limit);
  const target = limit - marker.length;
  const lineBreak = section.lastIndexOf('\n', target);
  const cut = lineBreak > target / 2 ? lineBreak : target;
  marker = markerFor(section.length - cut);
  return `${section.slice(0, Math.min(cut, Math.max(0, limit - marker.length)))}${marker}`;
}

// Water-filling keeps one huge generated file from starving the other files of budget.
function allocateBudgetFairly(sizes, budget) {
  const allocation = sizes.map(() => 0);
  let active = sizes.map((_, index) => index);
  let remaining = budget;
  while (active.length > 0 && remaining > 0) {
    const share = Math.floor(remaining / active.length);
    if (share === 0) break;
    const stillActive = [];
    for (const index of active) {
      const need = sizes[index] - allocation[index];
      const grant = Math.min(need, share);
      allocation[index] += grant;
      remaining -= grant;
      if (grant < need) stillActive.push(index);
    }
    active = stillActive;
  }
  return allocation;
}

export function truncateDiffForPrompt(diff, budget = STAGED_DIFF_BYTE_BUDGET) {
  if (diff.length <= budget) return diff;
  const sections = splitDiffIntoFileSections(diff);
  if (sections.length <= 1) return clipSectionOnLineBoundary(diff, budget);
  const allocations = allocateBudgetFairly(sections.map((section) => section.length), budget);
  return sections.map((section, index) => clipSectionOnLineBoundary(section, allocations[index])).join('');
}

export function cleanGeneratedMessage(raw) {
  let text = raw.replace(/\r\n/g, '\n').trim();
  const firstNewline = text.indexOf('\n');
  if (firstNewline !== -1) {
    const firstLine = text.slice(0, firstNewline);
    if (/^(generating|thinking)\b/i.test(firstLine) || /^[.…]+$/.test(firstLine.trim())) {
      text = text.slice(firstNewline + 1).trim();
    }
  }
  if (text.startsWith('<think>')) {
    const close = text.indexOf('</think>');
    if (close !== -1) text = text.slice(close + '</think>'.length).trim();
  }
  const fenced = /^```[^\n]*\n([\s\S]*?)\n```$/.exec(text);
  if (fenced) text = fenced[1].trim();
  return text.replace(/^(?:[-*•●]\s+|\d+[.)]\s+)/, '').trim();
}

export function agentArgs(agent, model) {
  const modelArgs = model ? ['--model', model] : [];
  if (agent === 'codex') return ['codex', 'exec', '--ephemeral', '--skip-git-repo-check', '-s', 'read-only', ...modelArgs];
  return ['claude', '-p', '--output-format', 'text', ...modelArgs, '--permission-mode', 'plan'];
}

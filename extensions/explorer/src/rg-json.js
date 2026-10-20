import { shellQuote } from './shared/bridge.js';

export const MAX_CONTENT_MATCHES = 2000;
export const MAX_RG_OUTPUT_BYTES = 4_000_000;

export function rgCommand(query, { caseSensitive, wholeWord, useRegex }) {
  const flags = ['--json', '--no-config', '--hidden', "--glob '!.git'", '--max-filesize 5M', '--max-count 200'];
  if (!caseSensitive) flags.push('--ignore-case');
  if (wholeWord) flags.push('--word-regexp');
  if (!useRegex) flags.push('--fixed-strings');
  const exitLine = '{"type":"exit","code":%d}\\n';
  return `{ rg ${flags.join(' ')} -- ${shellQuote(query)} .; printf '${exitLine}' $?; } | head -c ${MAX_RG_OUTPUT_BYTES}`;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function parseRgJson(output, maxMatches = MAX_CONTENT_MATCHES) {
  const files = new Map();
  let totalMatches = 0;
  let truncated = false;
  let exitCode = null;
  for (const line of output.split('\n')) {
    if (!line) continue;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      truncated = true;
      continue;
    }
    if (message.type === 'exit') exitCode = message.code;
    if (message.type !== 'match') continue;
    const { path, lines, line_number: lineNumber, submatches = [] } = message.data ?? {};
    if (typeof path?.text !== 'string' || typeof lines?.text !== 'string') continue;
    if (totalMatches >= maxMatches) {
      truncated = true;
      continue;
    }
    const text = lines.text.replace(/\r?\n$/, '');
    const bytes = encoder.encode(text);
    const toChar = (offset) => decoder.decode(bytes.subarray(0, offset)).length;
    const filePath = path.text.replace(/^\.\//, '');
    let file = files.get(filePath);
    if (!file) files.set(filePath, (file = { path: filePath, matches: [] }));
    file.matches.push({ line: lineNumber, text, ranges: submatches.map((sub) => [toChar(sub.start), toChar(sub.end)]) });
    totalMatches++;
  }
  if (exitCode === null && output.length > 0) truncated = true;
  return { files: [...files.values()], totalMatches, truncated, exitCode };
}

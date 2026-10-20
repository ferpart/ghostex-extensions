import { shellQuote } from './shared/bridge.js';

export function headContentCommand(path) {
  const slash = path.lastIndexOf('/');
  const dir = slash === -1 ? '.' : path.slice(0, slash);
  const revision = shellQuote(`HEAD:./${path.slice(slash + 1)}`);
  return `cd ${shellQuote(dir)} && if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then echo repo; git show ${revision} 2>/dev/null; true; else echo norepo; fi`;
}

export function parseHeadContent(output) {
  const newline = output.indexOf('\n');
  const header = newline === -1 ? output.trim() : output.slice(0, newline);
  return { inRepo: header === 'repo', content: newline === -1 ? '' : output.slice(newline + 1) };
}

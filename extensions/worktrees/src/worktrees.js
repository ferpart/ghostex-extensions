import { shellQuote } from './shared/posix.js';

export function parseWorktreeList(porcelain) {
  const worktrees = [];
  for (const block of porcelain.split(/\n\s*\n/)) {
    const entry = { path: null, branch: null, detached: false, bare: false, prunable: false };
    for (const line of block.split('\n')) {
      if (line.startsWith('worktree ')) entry.path = line.slice('worktree '.length);
      else if (line.startsWith('branch ')) entry.branch = line.slice('branch '.length).replace(/^refs\/heads\//, '');
      else if (line === 'detached') entry.detached = true;
      else if (line === 'bare') entry.bare = true;
      else if (line.startsWith('prunable')) entry.prunable = true;
    }
    if (entry.path) worktrees.push(entry);
  }
  return worktrees.map((entry, index) => ({ ...entry, isMain: index === 0 })).filter((entry) => !entry.bare);
}

export function githubSlugOf(remoteUrl) {
  const match = /github\.com[:/]+([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?\s*$/i.exec(remoteUrl ?? '');
  return match ? `${match[1]}/${match[2]}` : null;
}

export function pullRequestState(pr) {
  if (!pr) return 'none';
  if (pr.state === 'MERGED') return 'merged';
  if (pr.state === 'CLOSED') return 'closed';
  return pr.isDraft ? 'draft' : 'open';
}

export function newestPullRequestByBranch(pullRequests) {
  const byBranch = new Map();
  for (const pr of pullRequests) {
    if (pr.isCrossRepository) continue;
    const current = byBranch.get(pr.headRefName);
    if (!current || pr.number > current.number) byBranch.set(pr.headRefName, pr);
  }
  return byBranch;
}

export function canDelete(worktree) {
  const finished = ['merged', 'closed'].includes(pullRequestState(worktree.pr));
  return !worktree.isMain && worktree.exists && finished && worktree.dirty === 0 && worktree.unpushed === 0;
}

export function blockers(worktree) {
  if (worktree.isMain) return ['main worktree'];
  if (!worktree.exists) return ['folder missing'];
  const found = [];
  if (!['merged', 'closed'].includes(pullRequestState(worktree.pr))) found.push('PR not merged or closed');
  if (worktree.dirty !== 0) found.push(worktree.dirty === null ? 'changes unknown' : `${worktree.dirty} uncommitted`);
  if (worktree.unpushed !== 0) found.push(worktree.unpushed === null ? 'unpushed unknown' : `${worktree.unpushed} unpushed`);
  return found;
}

export function parseDetails(output) {
  const fields = Object.fromEntries(
    output
      .split('\n')
      .map((line) => line.split('='))
      .filter(([key, value]) => key && value !== undefined)
  );
  if (fields.missing) return { exists: false, dirty: null, unpushed: null, committedAt: null };
  const number = (value) => (value === undefined || value === '' || Number.isNaN(Number(value)) ? null : Number(value));
  const committedSeconds = number(fields.committed);
  return {
    exists: true,
    dirty: number(fields.dirty),
    unpushed: fields.inpr === '1' ? 0 : number(fields.unpushed),
    committedAt: committedSeconds === null ? null : committedSeconds * 1000,
  };
}

function detailsScriptFor(path, headCommitOfPr) {
  const lines = [
    `cd ${shellQuote(path)} 2>/dev/null || { echo missing=1; exit 0; }`,
    `echo "dirty=$(git status --porcelain | wc -l | tr -d ' ')"`,
    `echo "unpushed=$(git rev-list --count HEAD --not --remotes 2>/dev/null)"`,
    `echo "committed=$(git log -1 --format=%ct 2>/dev/null)"`,
  ];
  if (headCommitOfPr) lines.push(`git merge-base --is-ancestor HEAD ${shellQuote(headCommitOfPr)} 2>/dev/null && echo inpr=1`);
  return lines.join('\n');
}

const DETAILS_SEPARATOR = '@@';

export function detailsScript(items) {
  return `${items.map(({ path, headCommitOfPr }) => `echo ${DETAILS_SEPARATOR}\n(\n${detailsScriptFor(path, headCommitOfPr)}\n)`).join('\n')}\ntrue`;
}

export function parseBatchDetails(output) {
  return output
    .split(`${DETAILS_SEPARATOR}\n`)
    .slice(1)
    .map(parseDetails);
}

export function repoNameOf(commonDir) {
  const parts = commonDir.replace(/\/+$/, '').split('/');
  return parts.at(-1) === '.git' ? parts.at(-2) : parts.at(-1);
}

export function sortWorktrees(worktrees) {
  return [...worktrees].sort((a, b) => Number(b.isMain) - Number(a.isMain) || (b.committedAt ?? 0) - (a.committedAt ?? 0));
}

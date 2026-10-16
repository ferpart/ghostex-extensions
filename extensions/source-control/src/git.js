import { run, shellQuote, waitForBridge, writeFile } from './shared/bridge.js';
import { agentArgs, buildCommitPrompt, cleanGeneratedMessage } from './commit-prompt.js';
import { changeListArgs, parseChangeList, parseNumstat, parseStatus, withStats } from './git-parse.js';
import { buildColorMap, buildGraphRows, logCommand, parseLog } from './git-history.js';

const MAX_FILE_BYTES = 2_000_000;
const MAX_DIFF_BYTES = 1_000_000;
const REMOTE = 'GIT_TERMINAL_PROMPT=0 git';
const q = shellQuote;

function toBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

// Ghostex runs exec in the login shell (zsh, fish, ...), so each script goes to /bin/sh as base64.
async function sh(script, options) {
  try {
    return await run(`printf %s ${toBase64(script)} | base64 -d | /bin/sh`, options);
  } catch (error) {
    throw new Error(`${script.split('\n')[0]}${error.message.slice(error.message.indexOf(' failed (exit'))}`);
  }
}

export async function repoRoot(cwd) {
  return (await sh('git rev-parse --show-toplevel', { cwd })).trim();
}

export async function loadStatus(cwd) {
  const [status, unstagedStats, stagedStats] = await Promise.all([
    sh('git status --porcelain=v2 -z --branch --untracked-files=all', { cwd }),
    sh('git diff --numstat -z', { cwd }),
    sh('git diff --cached --numstat -z', { cwd }),
  ]);
  const { branch, staged, unstaged } = parseStatus(status);
  return {
    branch,
    staged: withStats(staged, parseNumstat(stagedStats)),
    unstaged: withStats(unstaged, parseNumstat(unstagedStats)),
  };
}

export async function resolveBaseBranch(cwd) {
  const candidates = ['origin/main', 'origin/master', 'main', 'master'].map(q).join(' ');
  const out = await sh(
    `git symbolic-ref --quiet --short refs/remotes/origin/HEAD || for ref in ${candidates}; do git rev-parse --verify --quiet "$ref^{commit}" >/dev/null && echo "$ref" && break; done`,
    { cwd, allowedExitCodes: [0, 1] }
  );
  return out.trim().split('\n')[0] || null;
}

export async function loadBranchChanges(cwd, base) {
  if (!base) return { mergeBase: null, entries: [] };
  const mergeBase = (await sh(`git merge-base HEAD ${q(base)}`, { cwd, allowedExitCodes: [0, 1] })).trim();
  if (!mergeBase) return { mergeBase: null, entries: [] };
  return { mergeBase, entries: parseChangeList(await sh(changeListArgs(mergeBase, 'HEAD'), { cwd })) };
}

export async function aheadBehind(cwd, target) {
  const out = await sh(`git rev-list --left-right --count ${q(`HEAD...${target}`)}`, { cwd, allowedExitCodes: [0, 128] });
  const [ahead, behind] = out.trim().split(/\s+/).map(Number);
  return { ahead: ahead || 0, behind: behind || 0 };
}

export async function loadPullRequest(cwd) {
  const out = await sh('gh pr view --json number,url,state', { cwd, allowedExitCodes: [0, 1] });
  return out.trim() ? JSON.parse(out) : null;
}

export async function loadHistory(cwd, { limit, branch, base }) {
  const [log, upstream, baseFullName] = await Promise.all([
    sh(logCommand(limit), { cwd }),
    branch ? sh(`git for-each-ref --format='%(upstream)' ${q(`refs/heads/${branch}`)}`, { cwd }) : '',
    base ? sh(`git rev-parse --symbolic-full-name ${q(base)}`, { cwd, allowedExitCodes: [0, 128] }) : '',
  ]);
  const parsed = parseLog(log);
  const items = parsed.slice(0, limit);
  const colorMap = buildColorMap({
    currentRef: branch ? `refs/heads/${branch}` : null,
    remoteRef: upstream.trim() || null,
    baseRef: baseFullName.trim() || null,
  });
  return { rows: buildGraphRows(items, colorMap, items[0]?.id), hasMore: parsed.length > limit };
}

export async function loadCommitFiles(cwd, item) {
  return parseChangeList(await sh(changeListArgs(item.parentIds[0] ?? null, item.id), { cwd }));
}

export async function readBlob(cwd, rev, path) {
  if (rev === null) return '';
  return sh(`git cat-file blob ${q(`${rev}:${path}`)} 2>/dev/null | head -c ${MAX_FILE_BYTES}`, { cwd });
}

export async function readWorktreeFile(cwd, path) {
  const quoted = q(`./${path}`);
  return sh(`if [ -f ${quoted} ]; then head -c ${MAX_FILE_BYTES} ${quoted}; fi`, { cwd });
}

const pathspec = (...paths) => paths.filter(Boolean).map(q).join(' ');

export const stage = (cwd, entry) => sh(`git add -A -- ${pathspec(entry.path)}`, { cwd });
export const unstage = (cwd, entry) => sh(`git restore --staged -- ${pathspec(entry.path, entry.oldPath)}`, { cwd });
export const stageAll = (cwd) => sh('git add -A', { cwd });
export const unstageAll = (cwd) => sh('git reset -q', { cwd });
export const discard = (cwd, entry) =>
  sh(entry.untracked ? `git clean -f -- ${pathspec(entry.path)}` : `git restore --worktree -- ${pathspec(entry.path)}`, { cwd });

export function commit(cwd, message, { amend = false } = {}) {
  const amendFlag = amend ? ' --amend' : '';
  if (amend && !message.trim()) return sh('git commit --amend --no-edit', { cwd });
  return sh(`printf %s ${q(message)} | git commit${amendFlag} -F -`, { cwd });
}

export const push = (cwd, hasUpstream) => sh(hasUpstream ? `${REMOTE} push` : `${REMOTE} push -u origin HEAD`, { cwd });
export const pull = (cwd) => sh(`${REMOTE} pull --ff-only`, { cwd });
export const fetch = (cwd) => sh(`${REMOTE} fetch --prune`, { cwd });
export const openPullRequest = (cwd) => sh('gh pr view --web', { cwd });
export const openBranch = (cwd, branch) => sh(`gh browse --branch ${q(branch)}`, { cwd });

async function readAgentPreferences() {
  const bridge = await waitForBridge();
  const settings = (await bridge.settings?.get().catch(() => null)) ?? {};
  const values = settings.preferences ?? settings.values ?? settings;
  return { agent: values.agent || 'claude', model: String(values.model ?? '').trim() };
}

export function generateCommitMessage(cwd) {
  const id = crypto.randomUUID();
  const promptPath = `/tmp/gx-commit-${id}.txt`;
  const pidPath = `/tmp/gx-commit-${id}.pid`;
  let cancelled = false;
  const result = (async () => {
    const diff = await sh(`git diff --cached --no-color --no-ext-diff | head -c ${MAX_DIFF_BYTES}`, { cwd });
    if (!diff.trim()) throw new Error('Stage changes first. The message comes from the staged diff.');
    const { agent, model } = await readAgentPreferences();
    await writeFile(promptPath, buildCommitPrompt(diff));
    const command = agentArgs(agent, model).map(q).join(' ');
    const out = await sh(
      `${command} < ${q(promptPath)} & echo $! > ${q(pidPath)}; wait $!; exit_code=$?; rm -f ${q(promptPath)} ${q(pidPath)}; exit $exit_code`,
      { cwd }
    ).catch((error) => {
      if (cancelled) return null;
      throw error;
    });
    return out === null || cancelled ? null : cleanGeneratedMessage(out);
  })();
  const cancel = () => {
    cancelled = true;
    return sh(`if [ -f ${q(pidPath)} ]; then kill "$(cat ${q(pidPath)})"; fi; rm -f ${q(promptPath)} ${q(pidPath)}`, { cwd });
  };
  return { result, cancel };
}

import { run, shellQuote, waitForBridge, writeFile } from './shared/bridge.js';
import { agentArgs, buildCommitPrompt, cleanGeneratedMessage } from './commit-prompt.js';
import { BRANCH_LIST_FORMAT, changeListArgs, parseBranchList, parseChangeList, parseNumstat, parseStatus, withStats } from './git-parse.js';
import { buildColorMap, buildGraphRows, logCommand, parseLog } from './git-history.js';

const MAX_FILE_BYTES = 2_000_000;
const MAX_DIFF_BYTES = 1_000_000;
const REMOTE = 'GIT_TERMINAL_PROMPT=0 git';
const q = shellQuote;

export async function repoRoot(cwd) {
  return (await run('git rev-parse --show-toplevel', { cwd })).trim();
}

export async function loadStatus(cwd) {
  const [status, unstagedStats, stagedStats] = await Promise.all([
    run('git status --porcelain=v2 -z --branch --untracked-files=all', { cwd }),
    run('git diff --numstat -z', { cwd }),
    run('git diff --cached --numstat -z', { cwd }),
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
  const out = await run(
    `git symbolic-ref --quiet --short refs/remotes/origin/HEAD || for ref in ${candidates}; do git rev-parse --verify --quiet "$ref^{commit}" >/dev/null && echo "$ref" && break; done`,
    { cwd, allowedExitCodes: [0, 1] }
  );
  return out.trim().split('\n')[0] || null;
}

export async function loadBranchChanges(cwd, base) {
  if (!base) return { mergeBase: null, entries: [] };
  const mergeBase = (await run(`git merge-base HEAD ${q(base)}`, { cwd, allowedExitCodes: [0, 1, 128] })).trim();
  if (!mergeBase) return { mergeBase: null, entries: [] };
  return { mergeBase, entries: parseChangeList(await run(changeListArgs(mergeBase, 'HEAD'), { cwd })) };
}

export async function listBranches(cwd) {
  return parseBranchList(await run(`git for-each-ref '--format=${BRANCH_LIST_FORMAT}' refs/heads refs/remotes`, { cwd }));
}

export async function refExists(cwd, ref) {
  const out = await run(`git rev-parse --verify --quiet ${q(`${ref}^{commit}`)}`, { cwd, allowedExitCodes: [0, 1] });
  return Boolean(out.trim());
}

const savedBaseKey = (projectPath) => `baseRef:${projectPath}`;

export async function loadSavedBase(projectPath) {
  const bridge = await waitForBridge();
  return (await bridge.storage.get(savedBaseKey(projectPath))) || null;
}

export async function saveBase(projectPath, ref) {
  const bridge = await waitForBridge();
  await bridge.storage.set(savedBaseKey(projectPath), ref ?? '');
}

export async function loadPullRequest(cwd) {
  const out = await run('gh pr view --json number,url,state', { cwd, allowedExitCodes: [0, 1] });
  return out.trim() ? JSON.parse(out) : null;
}

export async function loadHistory(cwd, { limit, branch, base }) {
  const [log, upstream, baseFullName] = await Promise.all([
    run(logCommand(limit), { cwd }),
    branch ? run(`git for-each-ref --format='%(upstream)' ${q(`refs/heads/${branch}`)}`, { cwd }) : '',
    base ? run(`git rev-parse --symbolic-full-name ${q(base)}`, { cwd, allowedExitCodes: [0, 128] }) : '',
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
  return parseChangeList(await run(changeListArgs(item.parentIds[0] ?? null, item.id), { cwd }));
}

export async function readBlob(cwd, rev, path) {
  if (rev === null) return '';
  return run(`git cat-file blob ${q(`${rev}:${path}`)} 2>/dev/null | head -c ${MAX_FILE_BYTES}`, { cwd });
}

export async function readWorktreeFile(cwd, path) {
  const quoted = q(`./${path}`);
  return run(`if [ -f ${quoted} ]; then head -c ${MAX_FILE_BYTES} ${quoted}; fi`, { cwd });
}

const pathspec = (...paths) => paths.filter(Boolean).map(q).join(' ');

export const stage = (cwd, entry) => run(`git add -A -- ${pathspec(entry.path)}`, { cwd });
export const unstage = (cwd, entry) => run(`git restore --staged -- ${pathspec(entry.path, entry.oldPath)}`, { cwd });
export const stageAll = (cwd) => run('git add -A', { cwd });
export const unstageAll = (cwd) => run('git reset -q', { cwd });
export const discard = (cwd, entry) =>
  run(entry.untracked ? `git clean -f -- ${pathspec(entry.path)}` : `git restore --worktree -- ${pathspec(entry.path)}`, { cwd });

export function commit(cwd, message, { amend = false } = {}) {
  const amendFlag = amend ? ' --amend' : '';
  if (amend && !message.trim()) return run('git commit --amend --no-edit', { cwd });
  return run(`printf %s ${q(message)} | git commit${amendFlag} -F -`, { cwd });
}

export const push = (cwd, hasUpstream) => run(hasUpstream ? `${REMOTE} push` : `${REMOTE} push -u origin HEAD`, { cwd });
export const pull = (cwd) => run(`${REMOTE} pull --ff-only`, { cwd });
export const fetch = (cwd) => run(`${REMOTE} fetch --prune`, { cwd });
export const openPullRequest = (cwd) => run('gh pr view --web', { cwd });
export const openBranch = (cwd, branch) => run(`gh browse --branch ${q(branch)}`, { cwd });

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
    const diff = await run(`git diff --cached --no-color --no-ext-diff | head -c ${MAX_DIFF_BYTES}`, { cwd });
    if (!diff.trim()) throw new Error('Stage changes first. The message comes from the staged diff.');
    const { agent, model } = await readAgentPreferences();
    await writeFile(promptPath, buildCommitPrompt(diff));
    const command = agentArgs(agent, model).map(q).join(' ');
    const out = await run(
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
    return run(`if [ -f ${q(pidPath)} ]; then kill "$(cat ${q(pidPath)})"; fi; rm -f ${q(promptPath)} ${q(pidPath)}`, { cwd });
  };
  return { result, cancel };
}

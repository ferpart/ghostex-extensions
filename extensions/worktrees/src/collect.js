import { run, shellQuote } from './shared/bridge.js';
import {
  detailsScript,
  githubSlugOf,
  newestPullRequestByBranch,
  parseBatchDetails,
  parseWorktreeList,
  repoNameOf,
  sortWorktrees,
} from './worktrees.js';

const CONCURRENCY = 6;
const PR_CACHE_MS = 60_000;
const PR_LIMIT = 200;
const PR_FIELDS = 'number,state,isDraft,headRefName,headRefOid,isCrossRepository,url,updatedAt';

function createLimiter(max) {
  let active = 0;
  const waiting = [];
  return async (task) => {
    if (active >= max) await new Promise((resolve) => waiting.push(resolve));
    else active += 1;
    try {
      return await task();
    } finally {
      const next = waiting.shift();
      if (next) next();
      else active -= 1;
    }
  };
}

const limit = createLimiter(CONCURRENCY);
const pullRequestCache = new Map();

const normalizePath = (path) => path.replace(/\/+$/, '') || '/';

export async function loadProjects(bridge, context) {
  try {
    const result = await bridge.cli('state');
    if (result.exitCode !== 0) throw new Error((result.stderr || result.stdout || 'ghostex state failed').trim());
    const projects = JSON.parse(result.stdout).projects.map(({ projectId, name, path }) => ({ projectId, name, path: normalizePath(path) }));
    return { projects, note: null };
  } catch (error) {
    const path = context?.project?.path;
    if (!path) throw error;
    return {
      projects: [{ projectId: null, name: context.project.name, path: normalizePath(path) }],
      note: `The Ghostex project list is unavailable (${error.message}). Showing the open project only.`,
    };
  }
}

async function indexProjects(projects) {
  const paths = [...new Set(projects.map((project) => project.path))];
  const output = await run(
    `for p in ${paths.map(shellQuote).join(' ')}; do
if [ -d "$p" ]; then printf '%s\\t%s\\n' "$p" "$(git -C "$p" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)"; else printf '%s\\tMISSING\\n' "$p"; fi
done`
  );
  const commonDirByPath = new Map(output.split('\n').filter(Boolean).map((line) => line.split('\t')));
  const reposById = new Map();
  const missing = [];
  for (const project of projects) {
    const commonDir = commonDirByPath.get(project.path);
    if (commonDir === 'MISSING') missing.push(project);
    else if (commonDir) {
      const repo = reposById.get(commonDir) ?? { id: commonDir, name: repoNameOf(commonDir), anchorPath: project.path, projects: [] };
      repo.projects.push(project);
      reposById.set(commonDir, repo);
    }
  }
  const repos = [...reposById.values()].sort((a, b) => a.name.localeCompare(b.name));
  return { repos, missing };
}

function loadPullRequests(slug, force) {
  const cached = pullRequestCache.get(slug);
  if (!force && cached && Date.now() - cached.at < PR_CACHE_MS) return cached.promise;
  const command = `GH_PROMPT_DISABLED=1 gh pr list -R ${shellQuote(slug)} --state all --limit ${PR_LIMIT} --json ${PR_FIELDS}`;
  const promise = limit(() => run(command)).then((json) => newestPullRequestByBranch(JSON.parse(json)));
  pullRequestCache.set(slug, { at: Date.now(), promise });
  promise.catch(() => pullRequestCache.delete(slug));
  return promise;
}

async function loadWorktrees(entries, pullRequests, projectByPath) {
  const prs = entries.map((entry) => (entry.branch ? pullRequests.get(entry.branch) : undefined));
  let details;
  try {
    const items = entries.map((entry, index) => ({ path: entry.path, headCommitOfPr: prs[index]?.headRefOid }));
    details = parseBatchDetails(await limit(() => run(detailsScript(items))));
  } catch {
    details = [];
  }
  return entries.map((entry, index) => ({
    ...entry,
    ...(details[index] ?? { exists: !entry.prunable, dirty: null, unpushed: null, committedAt: null }),
    pr: prs[index],
    project: projectByPath.get(entry.path) ?? null,
  }));
}

async function loadRepo(repo, force) {
  const anchor = shellQuote(repo.anchorPath);
  const listAndRemote = limit(() =>
    run(`git -C ${anchor} worktree list --porcelain\necho @@remote\ngit -C ${anchor} remote get-url origin 2>/dev/null || true`)
  );
  const [list, remote = ''] = (await listAndRemote).split('@@remote\n');
  const slug = githubSlugOf(remote);
  let pullRequests = new Map();
  let prError = slug ? null : 'No GitHub remote named origin.';
  if (slug) {
    try {
      pullRequests = await loadPullRequests(slug, force);
    } catch (error) {
      prError = error.message;
    }
  }
  const projectByPath = new Map(repo.projects.map((project) => [project.path, project]));
  const worktrees = await loadWorktrees(parseWorktreeList(list), pullRequests, projectByPath);
  return { slug, prError, worktrees: sortWorktrees(worktrees) };
}

export async function loadAll(projects, { force = false, onIndex, onRepo }) {
  const { repos, missing } = await indexProjects(projects);
  onIndex({ repos, missing });
  await Promise.all(
    repos.map(async (repo) => {
      try {
        onRepo(repo.id, await loadRepo(repo, force));
      } catch (error) {
        onRepo(repo.id, { error: error.message });
      }
    })
  );
}

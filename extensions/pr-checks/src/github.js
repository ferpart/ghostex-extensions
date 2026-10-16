import { run, shellQuote, waitForBridge } from './shared/bridge.js';
import { isBrokenCheck, mapRollupContexts, parseActionsRunId, PROMPT_LOG_TAIL_LINES } from './checks.js';
import { mapPullRequestComments } from './comments.js';

const PR_FIELDS =
  'number,title,state,isDraft,url,updatedAt,mergeable,mergeStateStatus,reviewDecision,headRefOid,headRefName,baseRefName,autoMergeRequest';

const COMMENT_FIELDS = `
  id
  databaseId
  author { __typename login avatarUrl(size: 48) }
  body
  bodyHTML
  createdAt
  url
  reactionGroups { content viewerHasReacted reactors { totalCount } }`;

const DETAILS_QUERY = `
query($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    mergeCommitAllowed
    squashMergeAllowed
    rebaseMergeAllowed
    autoMergeAllowed
    viewerDefaultMergeMethod
    pullRequest(number: $number) {
      id
      commits(last: 1) {
        nodes {
          commit {
            statusCheckRollup {
              contexts(first: 100) {
                nodes {
                  __typename
                  ... on CheckRun {
                    databaseId
                    name
                    status
                    conclusion
                    detailsUrl
                    url
                    checkSuite { app { slug } workflowRun { databaseId } }
                  }
                  ... on StatusContext { context state targetUrl }
                }
              }
            }
          }
        }
      }
      comments(first: 100) { nodes { ${COMMENT_FIELDS} } }
      reviews(first: 100) { nodes { ${COMMENT_FIELDS} } }
      reviewThreads(first: 100) {
        nodes {
          id
          isResolved
          line
          startLine
          originalLine
          originalStartLine
          comments(first: 100) { nodes { ${COMMENT_FIELDS} path } }
        }
      }
    }
  }
}`;

function ghCommand(args) {
  return `GH_PROMPT_DISABLED=1 gh ${args.map(shellQuote).join(' ')}`;
}

function gh(cwd, args) {
  return run(ghCommand(args), { cwd });
}

export function repoOf(prUrl) {
  const [, owner, repo] = new URL(prUrl).pathname.split('/');
  return { owner, repo, slug: `${owner}/${repo}` };
}

export async function loadPullRequest(cwd) {
  const bridge = await waitForBridge();
  const result = await bridge.exec(ghCommand(['pr', 'view', '--json', PR_FIELDS]), { cwd });
  if (result.exitCode === 0) return JSON.parse(result.stdout);
  const details = (result.stderr || result.stdout || '').trim();
  if (/no pull requests? found/i.test(details)) return null;
  throw new Error(`gh pr view failed (exit ${result.exitCode}): ${details || 'no output'}`);
}

export async function loadDetails(cwd, pr) {
  const { owner, repo } = repoOf(pr.url);
  const response = JSON.parse(
    await gh(cwd, ['api', 'graphql', '-f', `query=${DETAILS_QUERY}`, '-f', `owner=${owner}`, '-f', `repo=${repo}`, '-F', `number=${pr.number}`])
  );
  const repository = response.data?.repository;
  const pullRequest = repository?.pullRequest;
  if (!pullRequest) throw new Error(response.errors?.[0]?.message ?? 'GitHub returned no pull request data.');
  const contexts = pullRequest.commits.nodes[0]?.commit.statusCheckRollup?.contexts.nodes ?? [];
  return {
    nodeId: pullRequest.id,
    checks: mapRollupContexts(contexts),
    comments: mapPullRequestComments(pullRequest),
    mergeMethods: {
      merge: repository.mergeCommitAllowed,
      squash: repository.squashMergeAllowed,
      rebase: repository.rebaseMergeAllowed,
      auto: repository.autoMergeAllowed,
      default: repository.viewerDefaultMergeMethod?.toLowerCase(),
    },
  };
}

const LOG_TIMESTAMP = /^\d{4}-\d\d-\d\dT[\d:.]+Z /gm;
const ANSI_ESCAPE = /\x1b\[[0-9;]*[A-Za-z]/g;

export async function loadJobLogTail(cwd, pr, check) {
  const { slug } = repoOf(pr.url);
  const command = `log=$(${ghCommand(['api', '--allow-escape-sequences', `repos/${slug}/actions/jobs/${check.checkRunId}/logs`])}) || exit $?; printf '%s\\n' "$log" | tail -n ${PROMPT_LOG_TAIL_LINES}`;
  return (await run(command, { cwd })).replace(ANSI_ESCAPE, '').replace(LOG_TIMESTAMP, '');
}

export async function rerunFailedChecks(cwd, pr, checks) {
  const { slug } = repoOf(pr.url);
  const broken = checks.filter(isBrokenCheck);
  const runIds = new Set(broken.map((check) => check.workflowRunId ?? parseActionsRunId(check.url)).filter(Boolean));
  const checkRunIds = broken.filter((check) => !check.workflowRunId && check.checkRunId).map((check) => check.checkRunId);
  if (runIds.size === 0 && checkRunIds.length === 0) throw new Error('No failed checks can be re-run from here.');
  for (const runId of runIds) await gh(cwd, ['api', '-X', 'POST', `repos/${slug}/actions/runs/${runId}/rerun-failed-jobs`]);
  for (const checkRunId of checkRunIds) await gh(cwd, ['api', '-X', 'POST', `repos/${slug}/check-runs/${checkRunId}/rerequest`]);
  return runIds.size + checkRunIds.length;
}

export function createPullRequest(cwd, { draft }) {
  return gh(cwd, ['pr', 'create', '--fill', ...(draft ? ['--draft'] : [])]);
}

export function mergePullRequest(cwd, pr, method, { auto = false } = {}) {
  return gh(cwd, ['pr', 'merge', String(pr.number), `--${method}`, ...(auto ? ['--auto'] : []), '-R', repoOf(pr.url).slug]);
}

export function disableAutoMerge(cwd, pr) {
  return gh(cwd, ['pr', 'merge', String(pr.number), '--disable-auto', '-R', repoOf(pr.url).slug]);
}

export function setDraft(cwd, pr, draft) {
  return gh(cwd, ['pr', 'ready', String(pr.number), ...(draft ? ['--undo'] : []), '-R', repoOf(pr.url).slug]);
}

export function setClosed(cwd, pr, closed) {
  return gh(cwd, ['pr', closed ? 'close' : 'reopen', String(pr.number), '-R', repoOf(pr.url).slug]);
}

function graphqlMutation(cwd, mutation, variables) {
  const args = ['api', 'graphql', '-f', `query=${mutation}`];
  for (const [name, value] of Object.entries(variables)) args.push('-f', `${name}=${value}`);
  return gh(cwd, args);
}

export function setReaction(cwd, subjectId, content, add) {
  const field = add ? 'addReaction' : 'removeReaction';
  return graphqlMutation(
    cwd,
    `mutation($subjectId: ID!, $content: ReactionContent!) { ${field}(input: {subjectId: $subjectId, content: $content}) { clientMutationId } }`,
    { subjectId, content }
  );
}

export function replyToThread(cwd, threadId, body) {
  return graphqlMutation(
    cwd,
    'mutation($threadId: ID!, $body: String!) { addPullRequestReviewThreadReply(input: {pullRequestReviewThreadId: $threadId, body: $body}) { clientMutationId } }',
    { threadId, body }
  );
}

export function setThreadResolved(cwd, threadId, resolved) {
  const field = resolved ? 'resolveReviewThread' : 'unresolveReviewThread';
  return graphqlMutation(cwd, `mutation($threadId: ID!) { ${field}(input: {threadId: $threadId}) { clientMutationId } }`, { threadId });
}

export function addPullRequestComment(cwd, subjectId, body) {
  return graphqlMutation(
    cwd,
    'mutation($subjectId: ID!, $body: String!) { addComment(input: {subjectId: $subjectId, body: $body}) { clientMutationId } }',
    { subjectId, body }
  );
}

export async function openExternal(cwd, url) {
  if (!/^https?:\/\//i.test(url)) throw new Error(`Refused to open ${url}: only http and https links can open.`);
  return run(`open ${shellQuote(url)} 2>/dev/null || xdg-open ${shellQuote(url)}`, { cwd });
}

export async function copyText(cwd, text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    await run(`printf %s ${shellQuote(text)} | pbcopy`, { cwd });
  }
}

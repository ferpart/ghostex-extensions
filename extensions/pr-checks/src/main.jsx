import { render } from 'preact';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { agentLabel, deliverToAgent } from './shared/agent.js';
import { projectPathOf, toast, useGhostexContext } from './shared/bridge.js';
import {
  autoMergeBlocker,
  badgeLines,
  buildFixBrokenChecksPrompt,
  checkKey,
  isPendingCheck,
  mergeBlocker,
  summarizeChecks,
} from './checks.js';
import { ChecksSection } from './checks-section.jsx';
import { buildPRCommentsResolutionPrompt, groupComments } from './comments.js';
import { CommentsSection } from './comments-section.jsx';
import * as github from './github.js';
import { ConfirmDialog, Menu } from './ui.jsx';
import './shared/base.css';
import './styles.css';

const PENDING_POLL_MS = 60_000;
const MERGE_METHODS = [
  ['merge', 'Create merge commit'],
  ['squash', 'Squash and merge'],
  ['rebase', 'Rebase and merge'],
];

function stateBadge(pr) {
  const state = pr.isDraft && pr.state === 'OPEN' ? 'DRAFT' : pr.state;
  return <span class={`state-badge state-${state.toLowerCase()}`}>{state}</span>;
}

function MergeControls({ cwd, pr, details, method, setMethod, busy, ask, act }) {
  if (pr.state !== 'OPEN') return null;
  const allowed = MERGE_METHODS.filter(([key]) => details.mergeMethods[key] !== false);
  const [selectedMethod, label] = allowed.find(([key]) => key === method) ?? allowed[0] ?? MERGE_METHODS[0];
  const blocker = mergeBlocker(pr);
  const autoBlocker = autoMergeBlocker(pr, details.mergeMethods.auto);

  const merge = () =>
    ask({
      title: `${label} for #${pr.number}?`,
      body: `GitHub merges ${pr.headRefName} into ${pr.baseRefName}. You cannot undo this from here.`,
      label,
      action: () => act(`Merged #${pr.number}`, () => github.mergePullRequest(cwd, pr, selectedMethod)),
    });
  const enableAuto = () =>
    ask({
      title: `Enable auto-merge for #${pr.number}?`,
      body: `GitHub runs "${label}" when all requirements pass.`,
      label: 'Enable auto-merge',
      action: () => act('Auto-merge enabled', () => github.mergePullRequest(cwd, pr, selectedMethod, { auto: true })),
    });
  const disableAuto = () => act('Auto-merge disabled', () => github.disableAutoMerge(cwd, pr));

  return (
    <div class="merge">
      <div class="split-button">
        <button class="gx-button merge-button" disabled={busy || Boolean(blocker)} title={blocker ?? ''} onClick={merge}>
          {label}
        </button>
        <Menu
          label="▾"
          title="Merge options"
          class="gx-button merge-button merge-toggle"
          items={[
            ...allowed.map(([key, itemLabel]) => ({ label: itemLabel, checked: key === selectedMethod, onSelect: () => setMethod(key) })),
            'separator',
            pr.autoMergeRequest
              ? { label: 'Disable auto-merge', disabled: busy, onSelect: disableAuto }
              : { label: 'Enable auto-merge', disabled: busy || Boolean(autoBlocker), title: autoBlocker ?? '', onSelect: enableAuto },
          ]}
        />
      </div>
      {pr.autoMergeRequest && (
        <div class="merge-note">Auto-merge is on ({pr.autoMergeRequest.mergeMethod?.toLowerCase() ?? 'default method'}). GitHub merges when requirements pass.</div>
      )}
      {blocker && <div class="merge-note merge-blocked">Cannot merge: {blocker}</div>}
    </div>
  );
}

function PullRequestHeader({ cwd, pr, refreshing, busy, onRefresh, ask, act }) {
  const items = [
    { label: 'Open in browser', onSelect: () => github.openExternal(cwd, pr.url) },
    { label: 'Copy URL', onSelect: () => github.copyText(cwd, pr.url).then(() => toast('Copied the PR URL')) },
    pr.state === 'OPEN' && 'separator',
    pr.state === 'OPEN' &&
      (pr.isDraft
        ? { label: 'Mark ready for review', disabled: busy, onSelect: () => act('Marked ready for review', () => github.setDraft(cwd, pr, false)) }
        : { label: 'Convert to draft', disabled: busy, onSelect: () => act('Converted to draft', () => github.setDraft(cwd, pr, true)) }),
    pr.state === 'OPEN' && {
      label: 'Close PR',
      disabled: busy,
      onSelect: () =>
        ask({
          title: `Close #${pr.number}?`,
          body: 'GitHub closes the PR without a merge. You can reopen it later.',
          label: 'Close PR',
          danger: true,
          action: () => act(`Closed #${pr.number}`, () => github.setClosed(cwd, pr, true)),
        }),
    },
    pr.state === 'CLOSED' && { label: 'Reopen PR', disabled: busy, onSelect: () => act(`Reopened #${pr.number}`, () => github.setClosed(cwd, pr, false)) },
  ];
  return (
    <header class="pr-header">
      <div class="pr-title-row">
        <button class="gx-link pr-number" title="Open in browser" onClick={() => github.openExternal(cwd, pr.url)}>
          #{pr.number}
        </button>
        {stateBadge(pr)}
        <span class="pr-header-actions">
          <button class="gx-button gx-button-ghost icon-button" title="Refresh" disabled={refreshing} onClick={onRefresh}>
            <span class={refreshing ? 'spin' : ''}>↻</span>
          </button>
          <Menu label="⋯" title="PR actions" items={items} />
        </span>
      </div>
      <div class="pr-title">{pr.title}</div>
      <div class="gx-muted">
        {pr.headRefName} → {pr.baseRefName} · PR updated {new Date(pr.updatedAt).toLocaleString()}
      </div>
    </header>
  );
}

function NoPullRequest({ cwd, context, busy, ask, act }) {
  const branch = context?.worktree?.branch;
  const create = (draft) =>
    ask({
      title: draft ? 'Create a draft PR?' : 'Create a PR?',
      body: `gh pr create --fill${draft ? ' --draft' : ''} opens a PR for ${branch ?? 'this branch'}. It uses the commit messages for the title and the body. Push the branch first.`,
      label: draft ? 'Create draft PR' : 'Create PR',
      action: () => act(draft ? 'Created a draft PR' : 'Created the PR', () => github.createPullRequest(cwd, { draft })),
    });
  return (
    <div class="no-pr">
      <div>No pull request for {branch ? <code>{branch}</code> : 'this branch'}.</div>
      <div class="no-pr-actions">
        <button class="gx-button gx-button-primary" disabled={busy} onClick={() => create(false)}>
          Create PR
        </button>
        <button class="gx-button" disabled={busy} onClick={() => create(true)}>
          Create draft PR
        </button>
      </div>
    </div>
  );
}

function App() {
  const { bridge, context, error: bridgeError } = useGhostexContext();
  const cwd = projectPathOf(context);
  const cwdRef = useRef(cwd);
  cwdRef.current = cwd;
  const [pr, setPr] = useState(undefined);
  const [details, setDetails] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [logs, setLogs] = useState({});
  const [confirmRequest, setConfirmRequest] = useState(null);
  const [method, setMethodState] = useState(null);
  const inFlight = useRef(null);

  const refresh = useCallback(() => {
    if (!cwd) return Promise.resolve();
    if (inFlight.current) return inFlight.current;
    setRefreshing(true);
    inFlight.current = (async () => {
      try {
        const nextPr = await github.loadPullRequest(cwd);
        const nextDetails = nextPr ? await github.loadDetails(cwd, nextPr) : null;
        if (cwdRef.current !== cwd) return;
        setPr(nextPr);
        setDetails(nextDetails);
        setLoadError(null);
      } catch (error) {
        if (cwdRef.current === cwd) setLoadError(error.message);
      } finally {
        inFlight.current = null;
        setRefreshing(false);
      }
    })();
    return inFlight.current;
  }, [cwd]);

  useEffect(() => {
    setPr(undefined);
    setDetails(null);
    setLogs({});
    setLoadError(null);
    refresh();
  }, [refresh, context?.worktree?.branch]);

  useEffect(() => {
    const onFocus = () => refresh();
    const onVisible = () => document.visibilityState === 'visible' && refresh();
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refresh]);

  const hasPending = details?.checks.some(isPendingCheck) ?? false;
  useEffect(() => {
    if (!hasPending) return;
    const timer = setInterval(refresh, PENDING_POLL_MS);
    return () => clearInterval(timer);
  }, [hasPending, refresh]);

  useEffect(() => {
    if (!bridge || pr === undefined) return;
    const lines = pr && details ? badgeLines(summarizeChecks(details.checks)) : [];
    Promise.resolve()
      .then(() => bridge.ui.setBadge(lines))
      .catch((error) => console.warn('setBadge failed', error));
  }, [bridge, pr, details]);

  useEffect(() => {
    bridge?.storage
      .get('mergeMethod')
      .then((saved) => saved && setMethodState(saved))
      .catch(() => {});
  }, [bridge]);

  useEffect(() => {
    const onClick = (event) => {
      const link = event.target.closest?.('a[href]');
      if (!link) return;
      event.preventDefault();
      github.openExternal(cwdRef.current, link.href).catch((error) => toast(error.message));
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, []);

  const act = async (successMessage, action) => {
    setBusy(true);
    try {
      await action();
      if (successMessage) await toast(successMessage);
      await refresh();
      return true;
    } catch (error) {
      await toast(error.message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const setMethod = (next) => {
    setMethodState(next);
    bridge?.storage.set('mergeMethod', next).catch(() => {});
  };

  const loadLog = async (check) => {
    const key = checkKey(check);
    if (!check.isActions || (logs[key] && !logs[key].error)) return logs[key];
    setLogs((previous) => ({ ...previous, [key]: { loading: true } }));
    let log;
    try {
      log = { text: await github.loadJobLogTail(cwd, pr, check) };
    } catch (error) {
      log = { error: error.message };
    }
    setLogs((previous) => ({ ...previous, [key]: log }));
    return log;
  };

  const sendToAgent = async (text, what) => {
    try {
      const session = await deliverToAgent(context, text);
      await toast(`Sent ${what} to ${session.title}`);
      return true;
    } catch (error) {
      await toast(error.message);
      return false;
    }
  };

  const fixChecks = async (checks) => {
    setBusy(true);
    const loaded = await Promise.all(checks.map(async (check) => [checkKey(check), await loadLog(check)]));
    setBusy(false);
    const prompt = buildFixBrokenChecksPrompt({
      reviewNumber: pr.number,
      reviewTitle: pr.title,
      reviewUrl: pr.url,
      checks,
      logsByCheckKey: Object.fromEntries(loaded.filter(([, log]) => log)),
    });
    return sendToAgent(prompt, checks.length === 1 ? `the ${checks[0].name} failure` : `${checks.length} failing checks`);
  };

  const commentActions = {
    onReact: (comment, content, add) => act(null, () => github.setReaction(cwd, comment.nodeId, content, add)),
    onReply: (group, body) =>
      act('Reply posted', () =>
        group.kind === 'thread' ? github.replyToThread(cwd, group.threadId, body) : github.addPullRequestComment(cwd, details.nodeId, body)
      ),
    onResolve: (group, resolved) => act(resolved ? 'Thread resolved' : 'Thread unresolved', () => github.setThreadResolved(cwd, group.threadId, resolved)),
    onAddComment: (body) => act('Comment posted', () => github.addPullRequestComment(cwd, details.nodeId, body)),
    onSendToAgent: (groups) =>
      sendToAgent(
        buildPRCommentsResolutionPrompt({ reviewNumber: pr.number, reviewTitle: pr.title, reviewUrl: pr.url, groups, worktreePath: cwd }),
        `${groups.length} comment group(s)`
      ),
    onOpen: (url) => github.openExternal(cwd, url).catch((error) => toast(error.message)),
  };

  const ask = (request) => setConfirmRequest(request);
  const content = (() => {
    if (bridgeError) return <div class="gx-error">{bridgeError.message}</div>;
    if (!cwd) return <div class="empty gx-muted">Waiting for Ghostex…</div>;
    if (pr === undefined && loadError) return <div class="gx-error">{loadError}</div>;
    if (pr === undefined) return <div class="empty gx-muted">Loading the pull request for this branch…</div>;
    if (pr === null) return <NoPullRequest cwd={cwd} context={context} busy={busy} ask={ask} act={act} />;
    return (
      <>
        <PullRequestHeader cwd={cwd} pr={pr} refreshing={refreshing} busy={busy} onRefresh={refresh} ask={ask} act={act} />
        {loadError && <div class="gx-error">Refresh failed: {loadError}</div>}
        {details && (
          <>
            <MergeControls
              cwd={cwd}
              pr={pr}
              details={details}
              method={method ?? details.mergeMethods.default}
              setMethod={setMethod}
              busy={busy}
              ask={ask}
              act={act}
            />
            <div class="pr-body">
              <ChecksSection
                checks={details.checks}
                logs={logs}
                busy={busy}
                onLoadLog={loadLog}
                onFix={fixChecks}
                onRerun={() => act(null, async () => toast(`Started ${await github.rerunFailedChecks(cwd, pr, details.checks)} re-run(s)`))}
                onOpen={(url) => github.openExternal(cwd, url).catch((error) => toast(error.message))}
              />
              <CommentsSection groups={groupComments(details.comments)} busy={busy} actions={commentActions} />
            </div>
            <footer class="agent-footer gx-muted">Agent: {agentLabel(context)}</footer>
          </>
        )}
      </>
    );
  })();

  return (
    <>
      {content}
      <ConfirmDialog request={confirmRequest} onClose={() => setConfirmRequest(null)} />
    </>
  );
}

render(<App />, document.getElementById('root'));

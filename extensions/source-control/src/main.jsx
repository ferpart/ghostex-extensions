import { render } from 'preact';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { projectPathOf, toast, useGhostexContext } from './shared/bridge.js';
import { enableCodicons } from './shared/codicons.js';
import { useNotes } from './shared/notes.js';
import { NotesPanel } from './shared/notes-panel.jsx';
import { CommitsSection } from './commits.jsx';
import { DiffView } from './diff-view.jsx';
import { sumLines } from './git-parse.js';
import * as git from './git.js';
import { FileRow, Icon, IconButton, LineCounts, Section, useConfirm } from './ui.jsx';
import './shared/base.css';
import './styles.css';

const HISTORY_PAGE = 50;

function BranchHeader({ cwd, status, target, sync, pr, branchLines, busy, onRefresh }) {
  const branch = status.branch.head;
  const openInBrowser = () =>
    (pr ? git.openPullRequest(cwd) : git.openBranch(cwd, branch)).catch((error) => toast(error.message));
  return (
    <header class="branch-header">
      <div class="branch-line">
        {pr ? (
          <button class="pr-link" title={pr.url} onClick={openInBrowser}>
            <Icon name="git-pull-request" /> PR #{pr.number}
            <span class={`pr-state pr-${pr.state.toLowerCase()}`}>{pr.state.toLowerCase()}</span>
          </button>
        ) : (
          <span class="gx-muted">{pr === undefined ? 'Checking pull request…' : 'No pull request'}</span>
        )}
        <IconButton icon="refresh" title="Refresh" spin={busy === 'Refreshing'} onClick={onRefresh} />
      </div>
      <div class="branch-line">
        <span class="branch-name">{branch ?? `detached at ${status.branch.oid?.slice(0, 7) ?? 'nothing'}`}</span>
        {branchLines && <LineCounts {...branchLines} />}
      </div>
      <div class="branch-line">
        <span class="branch-target" title={status.branch.upstream ? 'Upstream branch' : 'Base branch (no upstream yet)'}>
          <Icon name="arrow-right" /> {target ?? 'no upstream or base'}
        </span>
        <span class="sync-counts" title={`${sync.ahead} to push, ${sync.behind} to pull`}>
          <Icon name="arrow-up" />{sync.ahead} <Icon name="arrow-down" />{sync.behind}
        </span>
        <IconButton
          icon="link-external"
          title={pr ? 'Open the pull request in the browser' : 'Open the branch in the browser'}
          disabled={!pr && !branch}
          onClick={openInBrowser}
        />
      </div>
    </header>
  );
}

function CommitBox({ cwd, status, busy, runAction, ask }) {
  const [message, setMessage] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [generation, setGeneration] = useState(null);
  const hasStaged = status.staged.length > 0;
  const hasHead = Boolean(status.branch.oid);
  const { upstream, head, ahead, behind } = status.branch;
  const canCommit = hasStaged && message.trim() && !busy;

  const generate = async () => {
    const job = git.generateCommitMessage(cwd);
    setGeneration(job);
    try {
      const generated = await job.result;
      if (generated) setMessage(generated);
    } catch (error) {
      toast(error.message);
    } finally {
      setGeneration(null);
    }
  };

  const commitThen = (label, after) =>
    runAction(label, async () => {
      await git.commit(cwd, message);
      setMessage('');
      await after?.();
    });

  const pushLabel = upstream ? `Push to ${upstream}?` : `Publish ${head} to origin?`;
  const actions = [
    { label: 'Commit', enabled: canCommit, run: () => commitThen('Committing') },
    {
      label: 'Commit & Push',
      enabled: canCommit,
      run: async () => (await ask(`Commit, then ${pushLabel[0].toLowerCase()}${pushLabel.slice(1)}`, 'Commit & Push')) &&
        commitThen('Committing and pushing', () => git.push(cwd, Boolean(upstream))),
    },
    {
      label: 'Commit & Sync',
      enabled: canCommit && Boolean(upstream),
      run: async () => (await ask(`Commit, pull --ff-only from ${upstream}, then push?`, 'Commit & Sync')) &&
        commitThen('Committing and syncing', async () => {
          await git.pull(cwd);
          await git.push(cwd, true);
        }),
    },
    {
      label: 'Amend',
      enabled: hasHead && !busy,
      run: async () =>
        (await ask(
          `Amend the last commit${message.trim() ? ' with the new message' : ''}${hasStaged ? ' and the staged changes' : ''}? ` +
            'If the commit is already pushed, the next push needs a force push.',
          'Amend'
        )) &&
        runAction('Amending', async () => {
          await git.commit(cwd, message, { amend: true });
          setMessage('');
        }),
    },
    {
      label: 'Push',
      enabled: Boolean(upstream) && !busy,
      run: async () => (await ask(`Push ${ahead} commit(s) to ${upstream}?`, 'Push')) && runAction('Pushing', () => git.push(cwd, true)),
    },
    {
      label: 'Pull',
      enabled: Boolean(upstream) && !busy,
      run: async () => (await ask(`Pull ${behind} commit(s) from ${upstream} (fast-forward only)?`, 'Pull')) && runAction('Pulling', () => git.pull(cwd)),
    },
    { label: 'Fetch', enabled: !busy, run: () => runAction('Fetching', () => git.fetch(cwd)) },
    {
      label: 'Publish branch',
      enabled: !upstream && Boolean(head) && !busy,
      run: async () => (await ask(`Publish ${head} to origin and set it as upstream?`, 'Publish')) && runAction('Publishing', () => git.push(cwd, false)),
    },
  ];

  return (
    <div class="commit-box">
      <div class="message-wrap">
        <textarea
          class="message"
          placeholder={hasStaged ? 'Message (⌘⏎ to commit)' : 'Message (stage changes to commit)'}
          value={message}
          disabled={Boolean(generation)}
          onInput={(event) => setMessage(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && canCommit) actions[0].run();
          }}
        />
        {generation ? (
          <button class="sparkle generating" title="Cancel message generation" onClick={() => generation.cancel()}>
            <Icon name="loading" spin /> Cancel
          </button>
        ) : (
          <IconButton icon="sparkle" title={hasStaged ? 'Generate the message from the staged diff' : 'Stage changes first'} disabled={!hasStaged || Boolean(busy)} onClick={generate} />
        )}
      </div>
      <div class="split-button">
        <button class="gx-button commit-main" disabled={!canCommit} title={hasStaged ? '' : 'Stage changes first'} onClick={actions[0].run}>
          <Icon name="check" /> Commit
        </button>
        <button class="gx-button commit-menu-toggle" aria-label="More commit actions" onClick={() => setMenuOpen(!menuOpen)}>
          <Icon name="chevron-down" />
        </button>
        {menuOpen && (
          <>
            <div class="menu-backdrop" onClick={() => setMenuOpen(false)} />
            <ul class="menu" role="menu">
              {actions.map((action) => (
                <li key={action.label}>
                  <button
                    role="menuitem"
                    disabled={!action.enabled}
                    onClick={() => {
                      setMenuOpen(false);
                      action.run();
                    }}
                  >
                    {action.label}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}

const fileTarget = (source, entry, mergeBase) =>
  ({
    staged: { label: 'HEAD ↔ index', original: { rev: 'HEAD', path: entry.oldPath ?? entry.path }, modified: { rev: '', path: entry.path } },
    unstaged: { label: 'index ↔ working tree', original: { rev: entry.untracked ? null : '', path: entry.path }, modified: { rev: 'worktree', path: entry.path } },
    branch: { label: 'merge-base ↔ HEAD', original: { rev: mergeBase, path: entry.oldPath ?? entry.path }, modified: { rev: 'HEAD', path: entry.path } },
  })[source];

function App() {
  const { context, error: bridgeError } = useGhostexContext();
  const projectPath = projectPathOf(context);
  const [cwd, setCwd] = useState(null);
  const [status, setStatus] = useState(null);
  const [base, setBase] = useState(null);
  const [branchChanges, setBranchChanges] = useState(null);
  const [baseSync, setBaseSync] = useState(null);
  const [pr, setPr] = useState(undefined);
  const [history, setHistory] = useState(null);
  const [historyLimit, setHistoryLimit] = useState(HISTORY_PAGE);
  const [loadError, setLoadError] = useState(null);
  const [busy, setBusy] = useState(null);
  const [diffTarget, setDiffTarget] = useState(null);
  const [version, setVersion] = useState(0);
  const refreshSequence = useRef(0);
  const { notes, add, remove } = useNotes(projectPath);
  const { ask, dialog } = useConfirm();

  useEffect(() => {
    if (!projectPath) return;
    setCwd(null);
    setStatus(null);
    setDiffTarget(null);
    setLoadError(null);
    git.repoRoot(projectPath).then(setCwd).catch(() => setLoadError(new Error(`${projectPath} is not a git repository.`)));
  }, [projectPath]);

  const refresh = useCallback(async () => {
    if (!cwd) return;
    const sequence = ++refreshSequence.current;
    const current = () => sequence === refreshSequence.current;
    try {
      const [nextStatus, nextBase] = await Promise.all([git.loadStatus(cwd), git.resolveBaseBranch(cwd)]);
      if (!current()) return;
      setStatus(nextStatus);
      setBase(nextBase);
      setLoadError(null);
      setVersion((value) => value + 1);
      const hasHead = Boolean(nextStatus.branch.oid);
      const [changes, nextHistory, nextBaseSync] = await Promise.all([
        hasHead ? git.loadBranchChanges(cwd, nextBase) : { mergeBase: null, entries: [] },
        hasHead ? git.loadHistory(cwd, { limit: historyLimit, branch: nextStatus.branch.head, base: nextBase }) : { rows: [], hasMore: false },
        hasHead && !nextStatus.branch.upstream && nextBase ? git.aheadBehind(cwd, nextBase) : null,
      ]);
      if (!current()) return;
      setBranchChanges(changes);
      setHistory(nextHistory);
      setBaseSync(nextBaseSync);
    } catch (error) {
      if (current()) setLoadError(error);
    }
  }, [cwd, historyLimit]);

  useEffect(() => {
    if (!cwd) return;
    setPr(undefined);
    git.loadPullRequest(cwd).then(setPr).catch(() => setPr(null));
  }, [cwd, status?.branch.head]);

  useEffect(() => {
    refresh();
    const onVisible = () => document.visibilityState === 'visible' && refresh();
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refresh, context?.activeSession?.sessionId]);

  const runAction = async (label, action) => {
    setBusy(label);
    try {
      await action();
    } catch (error) {
      setLoadError(error);
    } finally {
      setBusy(null);
      await refresh();
    }
  };

  if (bridgeError) return <div class="gx-error">{bridgeError.message}</div>;
  if (!projectPath) return <div class="gx-muted section-note">Waiting for the Ghostex project…</div>;
  if (!cwd || !status) {
    return loadError ? <div class="gx-error">{loadError.message}</div> : <div class="gx-muted section-note">Loading git status…</div>;
  }

  const openFile = (source, entry) => setDiffTarget({ key: `${source}:${entry.path}`, entry, ...fileTarget(source, entry, branchChanges?.mergeBase) });
  const openNote = (note) => {
    const sources = [['unstaged', status.unstaged], ['staged', status.staged], ['branch', branchChanges?.entries ?? []]];
    for (const [source, entries] of sources) {
      const entry = entries.find((candidate) => candidate.path === note.filePath);
      if (entry) return openFile(source, entry);
    }
    toast(`${note.filePath} has no open change in this panel.`);
  };
  const discard = async (entry) => {
    const what = entry.untracked ? `Delete the untracked file ${entry.path}?` : `Discard all unstaged changes in ${entry.path}?`;
    if (await ask(`${what} You cannot undo this.`, 'Discard')) runAction('Discarding', () => git.discard(cwd, entry));
  };

  const sync = status.branch.upstream ? status.branch : (baseSync ?? { ahead: 0, behind: 0 });
  const target = status.branch.upstream ?? base;
  const branchLines = branchChanges && sumLines(branchChanges.entries);

  return (
    <div class={`app${diffTarget ? ' has-diff' : ''}`}>
      <div class="sidebar">
        <BranchHeader cwd={cwd} status={status} target={target} sync={sync} pr={pr} branchLines={branchLines} busy={busy} onRefresh={() => runAction('Refreshing', async () => {})} />
        <CommitBox cwd={cwd} status={status} busy={busy} runAction={runAction} ask={ask} />
        {busy && (
          <div class="busy">
            <Icon name="loading" spin /> {busy}…
          </div>
        )}
        {loadError && (
          <div class="gx-error action-error">
            <span>{loadError.message}</span>
            <IconButton icon="close" title="Dismiss" onClick={() => setLoadError(null)} />
          </div>
        )}
        <div class="scroll">
          {status.staged.length > 0 && (
            <Section
              title="Staged changes"
              count={status.staged.length}
              actions={<IconButton icon="remove" title="Unstage all" disabled={Boolean(busy)} onClick={() => runAction('Unstaging', () => git.unstageAll(cwd))} />}
            >
              <ul class="file-list">
                {status.staged.map((entry) => (
                  <FileRow
                    key={entry.path}
                    entry={entry}
                    onOpen={() => openFile('staged', entry)}
                    actions={<IconButton icon="remove" title="Unstage" disabled={Boolean(busy)} onClick={() => runAction('Unstaging', () => git.unstage(cwd, entry))} />}
                  />
                ))}
              </ul>
            </Section>
          )}
          <Section
            title="Changes"
            count={status.unstaged.length}
            actions={
              status.unstaged.length > 0 && (
                <IconButton icon="add" title="Stage all" disabled={Boolean(busy)} onClick={() => runAction('Staging', () => git.stageAll(cwd))} />
              )
            }
          >
            {status.unstaged.length === 0 && <div class="gx-muted section-note">No uncommitted changes.</div>}
            <ul class="file-list">
              {status.unstaged.map((entry) => (
                <FileRow
                  key={entry.path}
                  entry={entry}
                  onOpen={() => openFile('unstaged', entry)}
                  actions={
                    <>
                      <IconButton icon="discard" title={entry.untracked ? 'Delete file' : 'Discard changes'} disabled={Boolean(busy)} onClick={() => discard(entry)} />
                      <IconButton icon="add" title="Stage" disabled={Boolean(busy)} onClick={() => runAction('Staging', () => git.stage(cwd, entry))} />
                    </>
                  }
                />
              ))}
            </ul>
          </Section>
          <Section title="Committed on branch" count={branchChanges ? branchChanges.entries.length : '…'}>
            {!base && <div class="gx-muted section-note">No base branch found (origin/HEAD, main or master).</div>}
            {base && branchChanges?.entries.length === 0 && <div class="gx-muted section-note">No commits on this branch since {base}.</div>}
            <ul class="file-list">
              {branchChanges?.entries.map((entry) => (
                <FileRow key={entry.path} entry={entry} onOpen={() => openFile('branch', entry)} />
              ))}
            </ul>
          </Section>
          <CommitsSection
            cwd={cwd}
            history={history}
            onLoadMore={() => setHistoryLimit((limit) => limit + HISTORY_PAGE)}
            onOpenFile={setDiffTarget}
          />
        </div>
      </div>
      {diffTarget && (
        <DiffView cwd={cwd} target={diffTarget} version={version} notes={notes} addNote={add} removeNote={remove} onClose={() => setDiffTarget(null)} />
      )}
      <NotesPanel context={context} projectPath={projectPath} notes={notes} onOpenNote={openNote} />
      {dialog}
    </div>
  );
}

enableCodicons();
render(<App />, document.getElementById('root'));

import { render } from 'preact';
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { toast, useGhostexContext } from './shared/bridge.js';
import { copyText, openExternal, revealInFinder, switchProject } from './actions.js';
import { loadAll, loadProjects } from './collect.js';
import { Menu, PullRequestIcon, timeAgo } from './ui.jsx';
import { blockers, canDelete, pullRequestState } from './worktrees.js';
import './shared/base.css';
import './styles.css';

const FOCUS_REFRESH_MIN_MS = 15_000;
const FILTERS = [
  ['all', 'All'],
  ['delete', 'Can delete'],
  ['open', 'Open PRs'],
];

const matchesFilter = (filter, worktree) => {
  if (filter === 'delete') return canDelete(worktree);
  if (filter === 'open') return ['open', 'draft'].includes(pullRequestState(worktree.pr));
  return true;
};

const report = (action) => (...args) => action(...args).catch((error) => toast(error.message));

function WorktreeRow({ worktree }) {
  const state = pullRequestState(worktree.pr);
  const deletable = canDelete(worktree);
  const folder = worktree.path.split('/').at(-1);
  const reasons = blockers(worktree);
  const menuItems = [
    worktree.project && worktree.exists && { label: 'Open project', onSelect: report(() => switchProject(worktree.path)) },
    { label: 'Copy path', onSelect: report(() => copyText(worktree.path).then(() => toast('Copied the path'))) },
    worktree.exists && { label: 'Reveal in Finder', onSelect: report(() => revealInFinder(worktree.path)) },
  ];
  return (
    <li class={`row ${deletable ? 'row-deletable' : ''}`} title={deletable ? 'Safe to delete' : `Not deletable: ${reasons.join(', ')}`}>
      <PullRequestIcon state={state} />
      <div class="row-main">
        <div class="row-top">
          <span class="branch">{worktree.branch ?? '(detached HEAD)'}</span>
          {worktree.isMain && <span class="tag">main worktree</span>}
          {deletable && <span class="tag tag-delete">🗑 Can delete</span>}
          {!worktree.exists && <span class="tag tag-warn">folder missing</span>}
          {worktree.exists && !worktree.project && <span class="tag">no project</span>}
        </div>
        <div class="row-meta gx-muted">
          <span>{folder}</span>
          {worktree.pr && (
            <button class="gx-link" title={worktree.pr.url} onClick={report(() => openExternal(worktree.pr.url))}>
              #{worktree.pr.number}
            </button>
          )}
          {worktree.dirty > 0 && <span class="count-dirty">{worktree.dirty} changed</span>}
          {worktree.unpushed > 0 && <span class="count-unpushed">{worktree.unpushed} unpushed</span>}
          {worktree.committedAt && <span>{timeAgo(worktree.committedAt)}</span>}
        </div>
      </div>
      <Menu label="⋯" title="Worktree actions" items={menuItems} />
    </li>
  );
}

function RepoGroup({ repo, filter }) {
  const rows = (repo.worktrees ?? []).filter((worktree) => matchesFilter(filter, worktree));
  if (repo.worktrees && !rows.length) return null;
  return (
    <section class="repo">
      <div class="gx-section-header">
        <span title={repo.slug ?? repo.id}>{repo.name}</span>
        {repo.refreshing && <span class="spin">↻</span>}
        <span class="gx-count">{rows.length}</span>
      </div>
      {repo.error && <div class="gx-error">{repo.error}</div>}
      {repo.prError && <div class="repo-note gx-muted">PR state unavailable: {repo.prError}</div>}
      {!repo.worktrees && !repo.error && <div class="repo-note gx-muted">Loading…</div>}
      <ul class="rows">
        {rows.map((worktree) => (
          <WorktreeRow key={worktree.path} worktree={worktree} />
        ))}
      </ul>
    </section>
  );
}

function MissingProjects({ projects }) {
  const [open, setOpen] = useState(false);
  if (!projects.length) return null;
  return (
    <section class="repo">
      <button class="gx-section-header missing-toggle" onClick={() => setOpen(!open)}>
        <span>{open ? '▾' : '▸'} Projects with a missing folder</span>
        <span class="gx-count">{projects.length}</span>
      </button>
      <ul class="rows">
        {open && projects.map((project) => (
          <li key={project.path} class="row" title={project.path}>
            <PullRequestIcon state="none" />
            <div class="row-main">
              <div class="row-top">
                <span class="branch">{project.name}</span>
                <span class="tag tag-warn">folder missing</span>
              </div>
              <div class="row-meta gx-muted">{project.path}</div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function showBadge(bridge, lines) {
  Promise.resolve()
    .then(() => bridge.ui.setBadge(lines))
    .catch((error) => console.warn('setBadge failed', error));
}

function App() {
  const { bridge, context, error: bridgeError } = useGhostexContext();
  const contextRef = useRef(context);
  contextRef.current = context;
  const [repos, setRepos] = useState([]);
  const [missing, setMissing] = useState([]);
  const [note, setNote] = useState(null);
  const [projectCount, setProjectCount] = useState(0);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState('all');
  const [loaded, setLoaded] = useState(false);
  const runId = useRef(0);
  const lastRefresh = useRef(0);

  const refresh = useCallback(
    async ({ force = false } = {}) => {
      if (!bridge) return;
      const id = ++runId.current;
      const current = () => runId.current === id;
      lastRefresh.current = Date.now();
      setLoading(true);
      setError(null);
      try {
        const { projects, note: projectsNote } = await loadProjects(bridge, contextRef.current);
        if (!current()) return;
        setNote(projectsNote);
        setProjectCount(projects.length);
        await loadAll(projects, {
          force,
          onIndex: ({ repos: indexed, missing: missingProjects }) => {
            if (!current()) return;
            setMissing(missingProjects);
            setRepos((previous) =>
              indexed.map((repo) => ({ ...previous.find((old) => old.id === repo.id), ...repo, refreshing: true }))
            );
          },
          onRepo: (repoId, result) => {
            if (!current()) return;
            setRepos((previous) => previous.map((repo) => (repo.id === repoId ? { ...repo, error: null, prError: null, ...result, refreshing: false } : repo)));
          },
        });
      } catch (caught) {
        if (current()) setError(caught.message);
      } finally {
        if (current()) {
          setLoading(false);
          setLoaded(true);
        }
      }
    },
    [bridge]
  );

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const refreshIfStale = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastRefresh.current > FOCUS_REFRESH_MIN_MS) refresh();
    };
    window.addEventListener('focus', refreshIfStale);
    document.addEventListener('visibilitychange', refreshIfStale);
    return () => {
      window.removeEventListener('focus', refreshIfStale);
      document.removeEventListener('visibilitychange', refreshIfStale);
    };
  }, [refresh]);

  const all = useMemo(() => repos.flatMap((repo) => repo.worktrees ?? []), [repos]);
  const counts = useMemo(
    () => ({
      all: all.length,
      delete: all.filter(canDelete).length,
      open: all.filter((worktree) => matchesFilter('open', worktree)).length,
    }),
    [all]
  );

  useEffect(() => {
    if (bridge && loaded) showBadge(bridge, counts.delete ? [`🗑 ${counts.delete}`] : []);
  }, [bridge, loaded, counts.delete]);

  const pending = repos.filter((repo) => repo.refreshing).length;
  const status = loading
    ? repos.length
      ? `Loading ${repos.length - pending} of ${repos.length} repos…`
      : 'Finding projects…'
    : loaded && `${projectCount} projects, ${repos.length} repos, ${all.length} worktrees`;
  const visibleRepos = repos.filter((repo) => !repo.worktrees || repo.worktrees.some((worktree) => matchesFilter(filter, worktree)) || repo.error);
  const empty = loaded && !loading && !error && !visibleRepos.length && !(filter === 'all' && missing.length);

  if (bridgeError) return <div class="gx-error">{bridgeError.message}</div>;
  return (
    <>
      <header class="toolbar">
        <div class="filters">
          {FILTERS.map(([key, label]) => (
            <button key={key} class={`gx-button filter ${filter === key ? 'filter-active' : ''}`} onClick={() => setFilter(key)}>
              {label} <span class="filter-count">{counts[key]}</span>
            </button>
          ))}
        </div>
        <button class="gx-button gx-button-ghost icon-button" title="Refresh" disabled={!bridge} onClick={() => refresh({ force: true })}>
          <span class={loading ? 'spin' : ''}>↻</span>
        </button>
      </header>
      {status && <div class="status-line gx-muted">{status}</div>}
      {note && <div class="repo-note gx-muted">{note}</div>}
      {error && <div class="gx-error">{error}</div>}
      <main>
        {!bridge && !bridgeError && <div class="empty gx-muted">Waiting for Ghostex…</div>}
        {visibleRepos.map((repo) => (
          <RepoGroup key={repo.id} repo={repo} filter={filter} />
        ))}
        {filter === 'all' && <MissingProjects projects={missing} />}
        {empty && <div class="empty gx-muted">{filter === 'delete' ? 'No worktree can be deleted.' : 'No worktrees found.'}</div>}
      </main>
    </>
  );
}

render(<App />, document.getElementById('root'));

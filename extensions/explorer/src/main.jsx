import { render } from 'preact';
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { execPosix, projectPathOf, run, shellQuote, toast, useGhostexContext, waitForBridge } from './shared/bridge.js';
import { useNotes } from './shared/notes.js';
import { NotesPanel } from './shared/notes-panel.jsx';
import { FileView } from './file-view.jsx';
import { rankPaths } from './fuzzy.js';
import { Icon } from './icons.jsx';
import { parseRgJson, rgCommand, MAX_RG_OUTPUT_BYTES } from './rg-json.js';
import { ContentResults, NameResults } from './search-results.jsx';
import { ancestorsOf, buildTree, parseGitStatus, splitNul } from './tree.js';
import { TreeView } from './tree-view.jsx';
import './shared/base.css';
import './styles.css';

const MAX_LIST_BYTES = 16_000_000;
const CONTENT_SEARCH_DELAY_MS = 300;
const EMPTY_STATUS = { files: new Map(), dirs: new Map() };

const listFilesCommand = `{ git ls-files -co --exclude-standard -z 2>/dev/null || rg --files --hidden -g '!.git' --null .; } | head -c ${MAX_LIST_BYTES}`;
const gitStatusCommand = `git rev-parse --show-prefix && git status --porcelain=v1 -z --untracked-files=all -- . | head -c ${MAX_LIST_BYTES}`;

async function loadListing(cwd) {
  const [files, status] = await Promise.all([
    run(listFilesCommand, { cwd }),
    run(gitStatusCommand, { cwd, allowedExitCodes: [0, 128] }).catch(() => ''),
  ]);
  const newline = status.indexOf('\n');
  return {
    paths: splitNul(files).map((path) => path.replace(/^\.\//, '')),
    gitStatus: newline === -1 ? EMPTY_STATUS : parseGitStatus(status.slice(newline + 1), status.slice(0, newline)),
  };
}

async function searchContents(cwd, query, options) {
  const result = await execPosix(rgCommand(query, options), { cwd });
  const parsed = parseRgJson(result.stdout);
  if (result.stdout.length >= MAX_RG_OUTPUT_BYTES) parsed.truncated = true;
  if (parsed.totalMatches === 0 && (parsed.exitCode ?? 2) > 1) {
    throw new Error((result.stderr || 'The search failed. Check that rg is installed.').trim());
  }
  return parsed;
}

function useContentSearch(cwd, query, options, enabled) {
  const [search, setSearch] = useState({ status: 'idle', result: null });
  useEffect(() => {
    if (!enabled || !cwd || !query.trim()) return setSearch({ status: 'idle', result: null });
    let alive = true;
    setSearch((previous) => ({ status: 'searching', result: previous.result }));
    const timer = setTimeout(() => {
      searchContents(cwd, query, options)
        .then((result) => alive && setSearch({ status: 'done', result }))
        .catch((error) => alive && setSearch({ status: 'error', result: null, message: error.message }));
    }, CONTENT_SEARCH_DELAY_MS);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [cwd, query, options, enabled]);
  return search;
}

function ProjectMenu({ cwd, openFile, editorRef, onClose }) {
  const targetPath = openFile ? `${cwd}/${openFile.path}` : cwd;
  const act = async (action) => {
    onClose();
    try {
      await action();
    } catch (error) {
      await toast(error.message);
    }
  };
  const revealInFinder = () => run(`open -R ${shellQuote(targetPath)}`, { cwd });
  const openInCode = async () => {
    const line = editorRef.current?.getPosition()?.lineNumber ?? openFile?.line ?? 1;
    const bridge = await waitForBridge();
    const result = await bridge.cli('edit', openFile ? ['--goto', `${targetPath}:${line}`] : [targetPath]);
    if (result.exitCode !== 0) throw new Error((result.stderr || result.stdout || 'ghostex edit failed').trim());
  };
  const copyPath = async () => {
    await run(`printf %s ${shellQuote(targetPath)} | pbcopy`, { cwd });
    await toast('Copied the path');
  };
  return (
    <>
      <div class="menu-backdrop" onClick={onClose} />
      <div class="menu" role="menu">
        <div class="menu-target gx-muted" title={targetPath}>{openFile ? openFile.path : 'Project folder'}</div>
        <button role="menuitem" onClick={() => act(revealInFinder)}><Icon name="go-to-file" /> Reveal in Finder</button>
        <button role="menuitem" onClick={() => act(openInCode)}><Icon name="link-external" /> Open in Ghostex Code</button>
        <button role="menuitem" onClick={() => act(copyPath)}><Icon name="copy" /> Copy path</button>
      </div>
    </>
  );
}

const OPTION_TOGGLES = [
  { key: 'caseSensitive', icon: 'case-sensitive', title: 'Match case' },
  { key: 'wholeWord', icon: 'whole-word', title: 'Match whole word' },
  { key: 'useRegex', icon: 'regex', title: 'Use regular expression' },
];

function SearchBox({ query, setQuery, mode, setMode, options, setOptions, onSubmit }) {
  return (
    <div class="search">
      <div class="search-input">
        <Icon name={mode === 'names' ? 'filter' : 'search'} />
        <input
          placeholder={mode === 'names' ? 'Find files' : 'Search in files'}
          value={query}
          onInput={(event) => setQuery(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') onSubmit();
            if (event.key === 'Escape') setQuery('');
          }}
        />
        {mode === 'contents' &&
          OPTION_TOGGLES.map(({ key, icon, title }) => (
            <button
              key={key}
              class={options[key] ? 'icon-button on' : 'icon-button'}
              title={title}
              aria-pressed={options[key]}
              onClick={() => setOptions((previous) => ({ ...previous, [key]: !previous[key] }))}
            >
              <Icon name={icon} />
            </button>
          ))}
      </div>
      <div class="segmented" role="tablist">
        <button role="tab" aria-selected={mode === 'names'} class={mode === 'names' ? 'on' : ''} onClick={() => setMode('names')}>Names</button>
        <button role="tab" aria-selected={mode === 'contents'} class={mode === 'contents' ? 'on' : ''} onClick={() => setMode('contents')}>Contents</button>
      </div>
    </div>
  );
}

function App() {
  const { context, error } = useGhostexContext();
  const cwd = projectPathOf(context);
  const [listing, setListing] = useState({ status: 'loading', paths: [], gitStatus: EMPTY_STATUS });
  const [expanded, setExpanded] = useState(() => new Set());
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState('names');
  const [options, setOptions] = useState({ caseSensitive: false, wholeWord: false, useRegex: false });
  const [openFile, setOpenFile] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [pendingOpen, setPendingOpen] = useState(undefined);
  const [menuOpen, setMenuOpen] = useState(false);
  const editorRef = useRef(null);
  const { notes, add, remove } = useNotes(cwd);

  const refresh = useCallback(() => {
    if (!cwd) return;
    setListing((previous) => ({ ...previous, status: previous.paths.length ? 'refreshing' : 'loading' }));
    loadListing(cwd)
      .then((loaded) => setListing({ status: 'ready', ...loaded }))
      .catch((loadError) => setListing({ status: 'error', message: loadError.message, paths: [], gitStatus: EMPTY_STATUS }));
  }, [cwd]);

  useEffect(() => {
    setExpanded(new Set());
    setOpenFile(null);
    setDirty(false);
    setQuery('');
    setListing({ status: 'loading', paths: [], gitStatus: EMPTY_STATUS });
    refresh();
  }, [refresh]);

  useEffect(() => {
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [refresh]);

  const tree = useMemo(() => buildTree(listing.paths), [listing.paths]);
  const ranked = useMemo(() => (mode === 'names' ? rankPaths(query, listing.paths) : null), [mode, query, listing.paths]);
  const search = useContentSearch(cwd, query, options, mode === 'contents');

  const applyOpen = (target) => {
    setPendingOpen(undefined);
    if (!target) return setOpenFile(null);
    setExpanded((previous) => new Set([...previous, ...ancestorsOf(target.path)]));
    setOpenFile({ ...target, revealKey: Date.now() });
  };
  const requestOpen = (target) => {
    const switchesFile = target?.path !== openFile?.path;
    if (dirty && switchesFile) return setPendingOpen(target);
    applyOpen(target);
  };
  const toggleDir = (path) =>
    setExpanded((previous) => {
      const next = new Set(previous);
      if (!next.delete(path)) next.add(path);
      return next;
    });
  const submitSearch = () => {
    if (mode === 'names' && ranked?.results[0]) requestOpen({ path: ranked.results[0].path });
    const firstFile = search.result?.files[0];
    if (mode === 'contents' && firstFile) requestOpen({ path: firstFile.path, line: firstFile.matches[0].line });
  };

  if (error) return <div class="gx-error">{error.message}</div>;
  if (!cwd) return <div class="placeholder gx-muted">Waiting for the Ghostex project…</div>;

  let body;
  if (listing.status === 'loading') body = <div class="placeholder gx-muted">Loading files…</div>;
  else if (listing.status === 'error') body = <div class="gx-error">Could not list files: {listing.message}</div>;
  else if (!query.trim()) {
    body = (
      <TreeView root={tree} expanded={expanded} gitStatus={listing.gitStatus} activePath={openFile?.path} onToggle={toggleDir} onOpen={requestOpen} />
    );
  } else if (mode === 'names') body = <NameResults ranked={ranked} gitStatus={listing.gitStatus} onOpen={requestOpen} />;
  else body = <ContentResults search={search} onOpen={requestOpen} />;

  return (
    <div class={openFile ? 'app has-file' : 'app'}>
      <div class="panes">
        <aside class="sidebar">
          <header class="explorer-header">
            <span class="project-name" title={cwd}>{context?.project?.name || cwd.split('/').pop()}</span>
            <button class="icon-button" title="Collapse folders" onClick={() => setExpanded(new Set())}><Icon name="collapse-all" /></button>
            <button class={listing.status === 'refreshing' ? 'icon-button spinning' : 'icon-button'} title="Refresh" onClick={refresh}>
              <Icon name="refresh" />
            </button>
            <button class="icon-button" title="More actions" onClick={() => setMenuOpen(true)}><Icon name="ellipsis" /></button>
            {menuOpen && <ProjectMenu cwd={cwd} openFile={openFile} editorRef={editorRef} onClose={() => setMenuOpen(false)} />}
          </header>
          <SearchBox query={query} setQuery={setQuery} mode={mode} setMode={setMode} options={options} setOptions={setOptions} onSubmit={submitSearch} />
          <div class="scroll">{body}</div>
        </aside>
        {openFile && (
          <main class="file-pane">
            {pendingOpen !== undefined && (
              <div class="confirm-bar">
                <span>Discard unsaved changes in {openFile.path.split('/').pop()}?</span>
                <button class="gx-button" onClick={() => setPendingOpen(undefined)}>Cancel</button>
                <button class="gx-button danger" onClick={() => { setDirty(false); applyOpen(pendingOpen); }}>Discard</button>
              </div>
            )}
            <FileView
              cwd={cwd}
              path={openFile.path}
              line={openFile.line}
              revealKey={openFile.revealKey}
              notes={notes}
              addNote={add}
              removeNote={remove}
              editorRef={editorRef}
              onDirtyChange={setDirty}
              onSaved={refresh}
              onClose={() => requestOpen(null)}
            />
          </main>
        )}
      </div>
      <NotesPanel context={context} projectPath={cwd} notes={notes} onOpenNote={(note) => requestOpen({ path: note.filePath, line: note.startLine })} />
    </div>
  );
}

render(<App />, document.getElementById('root'));

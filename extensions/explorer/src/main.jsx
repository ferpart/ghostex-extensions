import { render } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { projectPathOf, run, shellQuote, useGhostexContext } from './shared/bridge.js';
import { attachLineNotes } from './shared/line-notes.js';
import { createFileEditor, disposeEditor } from './shared/monaco-setup.js';
import { useNotes } from './shared/notes.js';
import { NotesPanel } from './shared/notes-panel.jsx';
import './shared/base.css';
import './styles.css';

function FileView({ cwd, path, notes, addNote, removeNote, onClose }) {
  const host = useRef(null);
  const lineNotes = useRef(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let editor;
    let alive = true;
    run(`cat ${shellQuote(path)}`, { cwd })
      .then((value) => {
        if (!alive) return;
        editor = createFileEditor(host.current, { path, value, readOnly: true });
        lineNotes.current = attachLineNotes(editor, {
          onAdd: (range) => addNote({ filePath: path, ...range }),
          onRemove: removeNote,
        });
        lineNotes.current.setNotes(notes.filter((note) => note.filePath === path));
      })
      .catch(setError);
    return () => {
      alive = false;
      lineNotes.current?.dispose();
      lineNotes.current = null;
      disposeEditor(editor);
    };
  }, [cwd, path]);

  useEffect(() => {
    lineNotes.current?.setNotes(notes.filter((note) => note.filePath === path));
  }, [notes, path]);

  return (
    <div class="file-view">
      <header class="gx-section-header">
        <button class="gx-button gx-button-ghost" onClick={onClose}>←</button>
        <span class="file-path">{path}</span>
      </header>
      {error && <div class="gx-error">{error.message}</div>}
      <div class="editor-host" ref={host} />
    </div>
  );
}

function App() {
  const { context, error } = useGhostexContext();
  const cwd = projectPathOf(context);
  const [files, setFiles] = useState([]);
  const [filter, setFilter] = useState('');
  const [openPath, setOpenPath] = useState(null);
  const { notes, add, remove } = useNotes(cwd);

  useEffect(() => {
    if (!cwd) return;
    setOpenPath(null);
    run('git ls-files -co --exclude-standard 2>/dev/null || rg --files --hidden -g "!.git"', { cwd })
      .then((out) => setFiles(out.split('\n').filter(Boolean).sort()))
      .catch(() => setFiles([]));
  }, [cwd]);

  if (error) return <div class="gx-error">{error.message}</div>;
  if (!cwd) return <div class="gx-muted">Loading…</div>;

  const shown = files.filter((file) => file.toLowerCase().includes(filter.toLowerCase())).slice(0, 500);
  return (
    <>
      {openPath ? (
        <FileView cwd={cwd} path={openPath} notes={notes} addNote={add} removeNote={remove} onClose={() => setOpenPath(null)} />
      ) : (
        <div class="file-list">
          <input class="filter" placeholder="Find files" value={filter} onInput={(event) => setFilter(event.currentTarget.value)} />
          <ul>
            {shown.map((file) => (
              <li key={file}>
                <button class="file-row" onClick={() => setOpenPath(file)}>{file}</button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <NotesPanel context={context} projectPath={cwd} notes={notes} onOpenNote={(note) => setOpenPath(note.filePath)} />
    </>
  );
}

render(<App />, document.getElementById('root'));

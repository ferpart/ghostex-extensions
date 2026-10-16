import { useEffect, useRef, useState } from 'preact/hooks';
import { readBlob, readWorktreeFile } from './git.js';
import { attachLineNotes } from './shared/line-notes.js';
import { createDiffEditor, disposeEditor } from './shared/monaco-setup.js';
import { IconButton } from './ui.jsx';

const readSide = (cwd, side) => (side.rev === 'worktree' ? readWorktreeFile(cwd, side.path) : readBlob(cwd, side.rev, side.path));

export function DiffView({ cwd, target, version, notes, addNote, removeNote, onClose }) {
  const host = useRef(null);
  const editor = useRef(null);
  const lineNotes = useRef(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const path = target.entry.path;
  const diffNotes = () => notes.filter((note) => note.filePath === path && note.source === 'diff');

  useEffect(() => {
    setError(null);
    setLoading(true);
    return () => {
      lineNotes.current?.dispose();
      lineNotes.current = null;
      disposeEditor(editor.current);
      editor.current = null;
    };
  }, [cwd, target.key]);

  useEffect(() => {
    if (target.entry.binary) return setLoading(false);
    let alive = true;
    Promise.all([readSide(cwd, target.original), readSide(cwd, target.modified)])
      .then(([original, modified]) => {
        if (!alive) return;
        setLoading(false);
        if (editor.current) {
          const model = editor.current.getModel();
          if (model.original.getValue() !== original) model.original.setValue(original);
          if (model.modified.getValue() !== modified) model.modified.setValue(modified);
          return;
        }
        editor.current = createDiffEditor(host.current, { path, original, modified });
        lineNotes.current = attachLineNotes(editor.current.getModifiedEditor(), {
          onAdd: (range) => addNote({ filePath: path, ...range, source: 'diff' }),
          onRemove: removeNote,
        });
        lineNotes.current.setNotes(diffNotes());
      })
      .catch((reason) => alive && setError(reason));
    return () => {
      alive = false;
    };
  }, [cwd, target.key, version]);

  useEffect(() => {
    lineNotes.current?.setNotes(diffNotes());
  }, [notes, path]);

  return (
    <div class="diff-view">
      <header class="diff-header">
        <IconButton icon="arrow-left" title="Close the diff" onClick={onClose} />
        <span class="diff-path" title={path}>{path}</span>
        <span class="gx-muted diff-label">{target.label}</span>
        <span
          class="expand-hint"
          title="Press Cmd+Ctrl+E in Ghostex to expand this view over the Agents Panel. The diff then opens next to the file lists."
        >
          Expand ⌘⌃E
        </span>
      </header>
      {error && <div class="gx-error">{error.message}</div>}
      {loading && !error && <div class="gx-muted section-note">Loading diff…</div>}
      {target.entry.binary && <div class="gx-muted section-note">Binary file. No text diff to show.</div>}
      <div class="editor-host" ref={host} />
    </div>
  );
}

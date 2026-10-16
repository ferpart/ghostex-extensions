import { useEffect, useRef, useState } from 'preact/hooks';
import { run, shellQuote, writeFile } from './shared/bridge.js';
import { attachLineNotes } from './shared/line-notes.js';
import { createFileEditor, disposeEditor, monaco } from './shared/monaco-setup.js';
import { Icon } from './icons.jsx';

const MAX_EDITOR_BYTES = 1_000_000;

function loadFileCommand(path) {
  const file = shellQuote(path);
  return [
    `[ -f ${file} ] || { echo missing; exit 0; }`,
    `size=$(($(wc -c < ${file})))`,
    `if [ "$size" -gt ${MAX_EDITOR_BYTES} ]; then echo "large $size"`,
    `elif [ "$size" -gt 0 ] && ! head -c 8000 ${file} | LC_ALL=C grep -qI ''; then echo binary`,
    `else echo text; cat ${file}; fi`,
  ].join('; ');
}

function unavailableMessage(header) {
  if (header === 'missing') return 'This path is not a regular file. It may be deleted, a folder, or a submodule.';
  if (header === 'binary') return 'This is a binary file. The editor does not open binary files.';
  const size = Number(header.split(' ')[1]);
  return `This file is ${(size / 1_000_000).toFixed(1)} MB. The editor opens files up to ${MAX_EDITOR_BYTES / 1_000_000} MB.`;
}

export function FileView({ cwd, path, line, revealKey, notes, addNote, removeNote, onClose, onDirtyChange, onSaved, editorRef }) {
  const host = useRef(null);
  const lineNotes = useRef(null);
  const saveRef = useRef(null);
  const [state, setState] = useState({ status: 'loading' });
  const [dirty, setDirty] = useState(false);
  const [saveState, setSaveState] = useState({ status: 'idle' });

  useEffect(() => onDirtyChange(dirty), [dirty]);

  useEffect(() => {
    let editor;
    let alive = true;
    setState({ status: 'loading' });
    setDirty(false);
    setSaveState({ status: 'idle' });
    run(loadFileCommand(path), { cwd })
      .then((output) => {
        if (!alive) return;
        const newline = output.indexOf('\n');
        const header = newline === -1 ? output.trim() : output.slice(0, newline);
        if (header !== 'text') return setState({ status: 'unavailable', message: unavailableMessage(header) });
        setState({ status: 'ready' });
        editor = createFileEditor(host.current, { path, value: output.slice(newline + 1) });
        editorRef.current = editor;
        const model = editor.getModel();
        let savedVersion = model.getAlternativeVersionId();
        model.onDidChangeContent(() => setDirty(model.getAlternativeVersionId() !== savedVersion));
        saveRef.current = async () => {
          const version = model.getAlternativeVersionId();
          setSaveState({ status: 'saving' });
          try {
            await writeFile(path, model.getValue(), { cwd });
            savedVersion = version;
            setDirty(model.getAlternativeVersionId() !== savedVersion);
            setSaveState({ status: 'saved' });
            onSaved();
          } catch (error) {
            setSaveState({ status: 'error', message: error.message });
          }
        };
        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => saveRef.current?.());
        lineNotes.current = attachLineNotes(editor, {
          onAdd: (range) => addNote({ filePath: path, ...range }),
          onRemove: removeNote,
        });
        lineNotes.current.setNotes(notes.filter((note) => note.filePath === path));
        revealLine(editor, line);
      })
      .catch((error) => alive && setState({ status: 'error', message: error.message }));
    return () => {
      alive = false;
      saveRef.current = null;
      lineNotes.current?.dispose();
      lineNotes.current = null;
      if (editorRef.current === editor) editorRef.current = null;
      disposeEditor(editor);
    };
  }, [cwd, path]);

  useEffect(() => {
    if (editorRef.current) revealLine(editorRef.current, line);
  }, [revealKey]);

  useEffect(() => {
    lineNotes.current?.setNotes(notes.filter((note) => note.filePath === path));
  }, [notes, path]);

  return (
    <div class="file-view">
      <header class="file-header">
        <button class="icon-button" title="Back to files" onClick={onClose}><Icon name="arrow-left" /></button>
        <span class="file-path" title={path}>{path}</span>
        {dirty && <span class="dirty-mark" title="Unsaved changes">●</span>}
        <span class="save-state gx-muted">
          {saveState.status === 'saving' ? 'Saving…' : saveState.status === 'saved' && !dirty ? 'Saved' : ''}
        </span>
        <button class="gx-button" disabled={!dirty} title="Save (Cmd+S)" onClick={() => saveRef.current?.()}>Save</button>
      </header>
      {saveState.status === 'error' && <div class="gx-error">Save failed: {saveState.message}</div>}
      {state.status === 'loading' && <div class="placeholder gx-muted">Loading {path}…</div>}
      {state.status === 'error' && <div class="gx-error">{state.message}</div>}
      {state.status === 'unavailable' && <div class="placeholder gx-muted">{state.message}</div>}
      <div class="editor-host" ref={host} />
    </div>
  );
}

function revealLine(editor, line) {
  if (line) {
    editor.revealLineInCenter(line);
    editor.setPosition({ lineNumber: line, column: 1 });
  }
  editor.focus();
}

import { useEffect, useRef, useState } from 'preact/hooks';
import { run, shellQuote, writeFile } from './shared/bridge.js';
import { attachLineNotes } from './shared/line-notes.js';
import { createDiffEditor, createFileEditor, disposeEditor, monaco } from './shared/monaco-setup.js';
import { SendNotesButton } from './shared/notes-panel.jsx';
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

const CHANGES_DISABLED_TITLE = 'This file has no uncommitted changes and no unsaved edits.';

function createChangesEditor(host, path, fileModel) {
  const editor = createDiffEditor(host, { path, original: '', modified: '' });
  const placeholders = editor.getModel();
  editor.setModel({ original: placeholders.original, modified: fileModel });
  placeholders.modified.dispose();
  editor.updateOptions({ readOnly: false });
  return { editor, original: placeholders.original };
}

export function FileView({
  context, cwd, path, line, revealKey, requestedMode, hasChanges, modeByPath,
  notes, addNote, removeNote, onClose, onDirtyChange, onSaved, editorRef,
}) {
  const editHost = useRef(null);
  const changesHost = useRef(null);
  const fileEditor = useRef(null);
  const changes = useRef(null);
  const lineNotes = useRef(null);
  const saveRef = useRef(null);
  const pendingLine = useRef(line);
  const [state, setState] = useState({ status: 'loading' });
  const [dirty, setDirty] = useState(false);
  const [saveState, setSaveState] = useState({ status: 'idle' });
  const [mode, setModeState] = useState('edit');
  const [diffState, setDiffState] = useState({ status: 'idle' });
  const canShowChanges = hasChanges || dirty;
  const fileNotes = notes.filter((note) => note.filePath === path);

  const setMode = (next) => {
    modeByPath.set(path, next);
    setModeState(next);
  };
  const activeEditor = () => (mode === 'changes' ? changes.current?.editor.getModifiedEditor() : fileEditor.current);
  const revealPending = () => {
    const editor = activeEditor();
    if (!editor) return;
    revealLine(editor, pendingLine.current);
    pendingLine.current = null;
  };

  useEffect(() => onDirtyChange(dirty), [dirty]);

  useEffect(() => {
    let alive = true;
    setState({ status: 'loading' });
    setDirty(false);
    setSaveState({ status: 'idle' });
    setDiffState({ status: 'idle' });
    const wanted = requestedMode ?? modeByPath.get(path) ?? 'edit';
    setModeState(wanted === 'changes' && hasChanges ? 'changes' : 'edit');
    run(loadFileCommand(path), { cwd })
      .then((output) => {
        if (!alive) return;
        const newline = output.indexOf('\n');
        const header = newline === -1 ? output.trim() : output.slice(0, newline);
        if (header !== 'text') return setState({ status: 'unavailable', message: unavailableMessage(header) });
        const editor = createFileEditor(editHost.current, { path, value: output.slice(newline + 1) });
        editor.updateOptions({ glyphMargin: false });
        fileEditor.current = editor;
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
        setState({ status: 'ready' });
      })
      .catch((error) => alive && setState({ status: 'error', message: error.message }));
    return () => {
      alive = false;
      saveRef.current = null;
      lineNotes.current?.dispose();
      lineNotes.current = null;
      changes.current?.editor.dispose();
      changes.current?.original.dispose();
      changes.current = null;
      editorRef.current = null;
      disposeEditor(fileEditor.current);
      fileEditor.current = null;
    };
  }, [cwd, path]);

  useEffect(() => {
    if (state.status !== 'ready') return;
    if (mode === 'edit') {
      editorRef.current = fileEditor.current;
      revealPending();
      return;
    }
    if (!changes.current) {
      changes.current = createChangesEditor(changesHost.current, path, fileEditor.current.getModel());
      const { editor } = changes.current;
      const modified = editor.getModifiedEditor();
      modified.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => saveRef.current?.());
      editor.onDidUpdateDiff(() =>
        setDiffState((previous) => ({ ...previous, identical: (editor.getLineChanges() ?? []).length === 0 }))
      );
      lineNotes.current = attachLineNotes(modified, {
        onAdd: (range) => addNote({ filePath: path, ...range, source: 'diff' }),
        onRemove: removeNote,
      });
      lineNotes.current.setNotes(fileNotes);
    }
    editorRef.current = changes.current.editor.getModifiedEditor();
    let alive = true;
    setDiffState({ status: 'loading' });
    run(`git show ${shellQuote(`HEAD:./${path}`)}`, { cwd, allowedExitCodes: [0, 128] })
      .then((head) => {
        if (!alive || !changes.current) return;
        changes.current.original.setValue(head);
        setDiffState((previous) => ({ ...previous, status: 'ready' }));
        revealPending();
      })
      .catch((error) => alive && setDiffState({ status: 'error', message: error.message }));
    return () => {
      alive = false;
    };
  }, [mode, state.status]);

  useEffect(() => {
    pendingLine.current = line;
    if (requestedMode && requestedMode !== mode && (requestedMode === 'edit' || canShowChanges)) setMode(requestedMode);
    else revealPending();
  }, [revealKey]);

  useEffect(() => {
    lineNotes.current?.setNotes(fileNotes);
  }, [notes, path]);

  const ready = state.status === 'ready';
  return (
    <div class="file-view">
      <header class="file-header">
        <button class="icon-button" title="Back to files" onClick={onClose}><Icon name="arrow-left" /></button>
        <span class="file-path" title={path}>{path}</span>
        <span class="expand-hint" title="Press Cmd+Ctrl+E to expand this panel over the Agents Panel">Expand ⌘⌃E</span>
        {dirty && <span class="dirty-mark" title="Unsaved changes">●</span>}
        <span class="save-state gx-muted">
          {saveState.status === 'saving' ? 'Saving…' : saveState.status === 'saved' && !dirty ? 'Saved' : ''}
        </span>
        {ready && (
          <div class="segmented mode-switch" role="tablist">
            <button role="tab" aria-selected={mode === 'edit'} class={mode === 'edit' ? 'on' : ''} onClick={() => setMode('edit')}>Edit</button>
            <button
              role="tab"
              aria-selected={mode === 'changes'}
              class={mode === 'changes' ? 'on' : ''}
              disabled={mode !== 'changes' && !canShowChanges}
              title={canShowChanges ? 'Show uncommitted changes as a diff' : CHANGES_DISABLED_TITLE}
              onClick={() => setMode('changes')}
            >
              Changes
            </button>
          </div>
        )}
        {fileNotes.length > 0 && <SendNotesButton context={context} projectPath={cwd} notes={fileNotes} />}
        <button class="gx-button" disabled={!dirty} title="Save (Cmd+S)" onClick={() => saveRef.current?.()}>Save</button>
      </header>
      {saveState.status === 'error' && <div class="gx-error">Save failed: {saveState.message}</div>}
      {state.status === 'loading' && <div class="placeholder gx-muted">Loading {path}…</div>}
      {state.status === 'error' && <div class="gx-error">{state.message}</div>}
      {state.status === 'unavailable' && <div class="placeholder gx-muted">{state.message}</div>}
      {ready && mode === 'changes' && diffState.status === 'loading' && <div class="banner gx-muted">Loading changes…</div>}
      {ready && mode === 'changes' && diffState.status === 'error' && <div class="gx-error">{diffState.message}</div>}
      {ready && mode === 'changes' && diffState.status === 'ready' && diffState.identical && (
        <div class="banner gx-muted">No uncommitted changes.</div>
      )}
      <div class="editor-host" ref={editHost} hidden={mode !== 'edit'} />
      <div class="editor-host" ref={changesHost} hidden={mode !== 'changes'} />
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

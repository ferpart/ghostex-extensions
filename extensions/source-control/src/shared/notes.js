import { useCallback, useEffect, useState } from 'preact/hooks';
import { waitForBridge } from './bridge.js';

const storageKey = (projectPath) => `notes:${projectPath}`;
const listeners = new Set();

export async function loadNotes(projectPath) {
  if (!projectPath) return [];
  const bridge = await waitForBridge();
  return (await bridge.storage.get(storageKey(projectPath))) ?? [];
}

async function saveNotes(projectPath, notes) {
  const bridge = await waitForBridge();
  await bridge.storage.set(storageKey(projectPath), notes);
  for (const listener of listeners) listener(projectPath, notes);
}

export async function addNote(projectPath, { filePath, startLine, endLine, body, source = 'file' }) {
  const note = {
    id: crypto.randomUUID(),
    filePath,
    startLine,
    endLine,
    body: body.trim(),
    source,
    createdAt: Date.now(),
    sentAt: null,
  };
  await saveNotes(projectPath, [...(await loadNotes(projectPath)), note]);
  return note;
}

export async function removeNote(projectPath, id) {
  await saveNotes(projectPath, (await loadNotes(projectPath)).filter((note) => note.id !== id));
}

export async function removeNotes(projectPath, ids) {
  const sent = new Set(ids);
  await saveNotes(projectPath, (await loadNotes(projectPath)).filter((note) => !sent.has(note.id)));
}

export async function clearNotes(projectPath) {
  await saveNotes(projectPath, []);
}

export async function markNotesSent(projectPath, ids) {
  const sentAt = Date.now();
  const wanted = new Set(ids);
  await saveNotes(
    projectPath,
    (await loadNotes(projectPath)).map((note) => (wanted.has(note.id) ? { ...note, sentAt } : note))
  );
}

export function useNotes(projectPath) {
  const [notes, setNotes] = useState([]);
  useEffect(() => {
    let alive = true;
    loadNotes(projectPath).then((loaded) => alive && setNotes(loaded));
    const listener = (path, next) => path === projectPath && setNotes(next);
    listeners.add(listener);
    return () => {
      alive = false;
      listeners.delete(listener);
    };
  }, [projectPath]);
  const add = useCallback((note) => addNote(projectPath, note), [projectPath]);
  const remove = useCallback((id) => removeNote(projectPath, id), [projectPath]);
  return { notes, add, remove };
}

function escapeBody(body) {
  return body.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r/g, '\\r').replace(/\n/g, '\\n');
}

function locationLabel(note) {
  if (!note.endLine) return 'Scope: file';
  if (note.startLine && note.startLine !== note.endLine) return `Lines: ${note.startLine}-${note.endLine}`;
  return `Line: ${note.endLine}`;
}

export function formatNote(note) {
  return [
    `File: ${note.filePath}`,
    ...(note.source === 'diff' ? ['Source: diff'] : []),
    locationLabel(note),
    `User comment: "${escapeBody(note.body)}"`,
  ].join('\n');
}

export function formatNotes(notes) {
  return notes.map(formatNote).join('\n\n');
}

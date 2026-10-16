import { useState } from 'preact/hooks';
import { agentLabel, deliverToAgent } from './agent.js';
import { toast } from './bridge.js';
import { clearNotes, formatNotes, removeNote, removeNotes } from './notes.js';

export function NotesPanel({ context, projectPath, notes, onOpenNote }) {
  const [busy, setBusy] = useState(false);
  if (notes.length === 0) return null;
  const toSend = notes;

  const send = async (queue) => {
    setBusy(true);
    try {
      const session = await deliverToAgent(context, formatNotes(toSend), { queue });
      await removeNotes(projectPath, toSend.map((note) => note.id));
      await toast(`${queue ? 'Queued' : 'Sent'} ${toSend.length} note(s) to ${session.title}`);
    } catch (error) {
      await toast(error.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section class="gx-notes">
      <header class="gx-section-header">
        <span>NOTES FOR THE AI</span>
        <span class="gx-count">{notes.length}</span>
        <button class="gx-button gx-button-ghost" onClick={() => clearNotes(projectPath)}>Clear</button>
      </header>
      <ul class="gx-notes-list">
        {notes.map((note) => (
          <li key={note.id} class="gx-note-row">
            <button class="gx-link" onClick={() => onOpenNote?.(note)}>
              {note.filePath.split('/').pop()}:{note.startLine === note.endLine ? note.endLine : `${note.startLine}-${note.endLine}`}
            </button>
            <span class="gx-note-preview">{note.body}</span>
            <button class="gx-button gx-button-ghost" title="Remove" onClick={() => removeNote(projectPath, note.id)}>×</button>
          </li>
        ))}
      </ul>
      <div class="gx-notes-actions">
        <button class="gx-button gx-button-primary" disabled={busy} title={`Send to ${agentLabel(context)}`} onClick={() => send(false)}>
          Send {toSend.length} to agent
        </button>
        <button class="gx-button" disabled={busy} title="Deliver when the agent finishes its turn" onClick={() => send(true)}>
          Queue
        </button>
      </div>
      <div class="gx-muted">To: {agentLabel(context)}</div>
    </section>
  );
}

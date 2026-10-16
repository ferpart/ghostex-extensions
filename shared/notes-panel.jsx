import { useState } from 'preact/hooks';
import { agentLabel, deliverToAgent } from './agent.js';
import { toast } from './bridge.js';
import { clearNotes, formatNotes, removeNote, removeNotes } from './notes.js';

export function SendNotesButton({ context, projectPath, notes }) {
  const [busy, setBusy] = useState(false);
  const target = agentLabel(context);

  const send = async (queue) => {
    setBusy(true);
    try {
      const session = await deliverToAgent(context, formatNotes(notes), { queue });
      await removeNotes(projectPath, notes.map((note) => note.id));
      await toast(`${queue ? 'Queued' : 'Sent'} ${notes.length} note(s) to ${session.title}`);
    } catch (error) {
      await toast(error.message);
    } finally {
      setBusy(false);
    }
  };

  const disabled = busy || notes.length === 0;
  return (
    <span class="gx-send-notes">
      <button class="gx-button gx-button-primary" disabled={disabled} title={`Send ${notes.length} note(s) to ${target}`} onClick={() => send(false)}>
        Send {notes.length}
      </button>
      <button class="gx-button" disabled={disabled} title={`Queue ${notes.length} note(s) for ${target}. They arrive when the agent finishes its turn.`} onClick={() => send(true)}>
        Queue
      </button>
    </span>
  );
}

export function NotesPanel({ context, projectPath, notes, onOpenNote }) {
  if (notes.length === 0) return null;
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
        <SendNotesButton context={context} projectPath={projectPath} notes={notes} />
        <span class="gx-muted">To: {agentLabel(context)}</span>
      </div>
    </section>
  );
}

import { monaco } from './monaco-setup.js';

const DRAFT_HEIGHT_PX = 150;
const NOTE_LINE_PX = 18;
const NOTE_CHROME_PX = 34;
const CARD_RIGHT_GAP_PX = 24;

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function isolateFromEditor(node) {
  for (const type of ['mousedown', 'mouseup', 'click', 'keydown', 'keyup', 'keypress', 'wheel']) {
    node.addEventListener(type, (event) => event.stopPropagation());
  }
  node.style.pointerEvents = 'auto';
  node.style.zIndex = '10';
}

// Monaco sets inline display on a zone's domNode, so the card sits inside a plain wrapper.
function zoneNodeFor(card) {
  const zone = element('div', 'gx-note-zone');
  zone.append(card);
  return zone;
}

function rangeLabel(startLine, endLine) {
  return startLine === endLine ? `LINE ${endLine}` : `LINES ${startLine}-${endLine}`;
}

function selectedLineRange(editor, fallbackLine) {
  const selection = editor.getSelection();
  if (!selection || selection.isEmpty()) {
    const line = fallbackLine ?? selection?.positionLineNumber ?? 1;
    return { startLine: line, endLine: line };
  }
  const startLine = selection.startLineNumber;
  let endLine = selection.endLineNumber;
  if (selection.endColumn === 1 && endLine > startLine) endLine -= 1;
  if (fallbackLine && (fallbackLine < startLine || fallbackLine > endLine)) {
    return { startLine: fallbackLine, endLine: fallbackLine };
  }
  return { startLine, endLine };
}

export function attachLineNotes(editor, { onAdd, onRemove }) {
  let notes = [];
  let draftZoneId = null;
  let noteZoneIds = [];
  const hoverDecorations = editor.createDecorationsCollection();
  const domNode = editor.getDomNode();

  const fitCardsToVisibleWidth = () => {
    const { width, contentLeft, verticalScrollbarWidth } = editor.getLayoutInfo();
    const visibleWidth = Math.max(0, width - contentLeft - verticalScrollbarWidth - CARD_RIGHT_GAP_PX);
    domNode.style.setProperty('--gx-note-card-visible-width', `${visibleWidth}px`);
  };
  fitCardsToVisibleWidth();
  const layoutChange = editor.onDidLayoutChange(fitCardsToVisibleWidth);
  const noteDecorations = editor.createDecorationsCollection();

  const closeDraft = () => {
    if (draftZoneId === null) return;
    editor.changeViewZones((accessor) => accessor.removeZone(draftZoneId));
    draftZoneId = null;
  };

  const openDraft = ({ startLine, endLine }) => {
    closeDraft();
    const card = element('div', 'gx-note-card gx-note-draft');
    isolateFromEditor(card);
    const textarea = element('textarea', 'gx-note-input');
    textarea.placeholder = 'Add note for the AI';
    const actions = element('div', 'gx-note-actions');
    const cancel = element('button', 'gx-button gx-button-ghost', 'Cancel');
    const submit = element('button', 'gx-button gx-button-primary', 'Add note ⏎');
    actions.append(cancel, submit);
    card.append(element('div', 'gx-note-label', rangeLabel(startLine, endLine)), textarea, actions);

    const save = async () => {
      const body = textarea.value.trim();
      if (!body) return;
      submit.disabled = true;
      await onAdd({ startLine, endLine, body });
      closeDraft();
      editor.focus();
    };
    cancel.addEventListener('click', () => {
      closeDraft();
      editor.focus();
    });
    submit.addEventListener('click', save);
    textarea.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        save();
      } else if (event.key === 'Escape') {
        closeDraft();
        editor.focus();
      }
    });

    editor.changeViewZones((accessor) => {
      draftZoneId = accessor.addZone({ afterLineNumber: endLine, heightInPx: DRAFT_HEIGHT_PX, domNode: zoneNodeFor(card) });
    });
    editor.revealLineInCenterIfOutsideViewport(endLine);
    requestAnimationFrame(() => textarea.focus());
  };

  const renderNotes = () => {
    editor.changeViewZones((accessor) => {
      for (const id of noteZoneIds) accessor.removeZone(id);
      noteZoneIds = notes.map((note) => {
        const card = element('div', 'gx-note-card gx-note-saved');
        isolateFromEditor(card);
        const header = element('div', 'gx-note-header');
        const remove = element('button', 'gx-button gx-button-ghost gx-note-remove', '×');
        remove.title = 'Remove note';
        remove.addEventListener('click', () => onRemove(note.id));
        header.append(
          element('span', 'gx-note-label', `${rangeLabel(note.startLine, note.endLine)}${note.sentAt ? ' · SENT' : ''}`),
          remove
        );
        card.append(header, element('div', 'gx-note-body', note.body));
        const lineCount = note.body.split('\n').length;
        return accessor.addZone({
          afterLineNumber: note.endLine,
          heightInPx: NOTE_CHROME_PX + NOTE_LINE_PX * lineCount,
          domNode: zoneNodeFor(card),
        });
      });
    });
    noteDecorations.set(
      notes.map((note) => ({
        range: new monaco.Range(note.startLine, 1, note.endLine, 1),
        options: { isWholeLine: true, className: 'gx-note-line', glyphMarginClassName: 'gx-note-glyph' },
      }))
    );
  };

  const mouseMove = editor.onMouseMove((event) => {
    const line = event.target.position?.lineNumber;
    hoverDecorations.set(
      line ? [{ range: new monaco.Range(line, 1, line, 1), options: { glyphMarginClassName: 'gx-note-add' } }] : []
    );
  });
  const mouseLeave = editor.onMouseLeave(() => hoverDecorations.clear());
  const mouseDown = editor.onMouseDown((event) => {
    if (event.target.type !== monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) return;
    const line = event.target.position?.lineNumber;
    if (line) openDraft(selectedLineRange(editor, line));
  });
  const action = editor.addAction({
    id: 'ghostex.addNoteForAgent',
    label: 'Add note for the AI',
    keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyM],
    contextMenuGroupId: 'navigation',
    contextMenuOrder: 0,
    run: () => openDraft(selectedLineRange(editor)),
  });

  return {
    setNotes(next) {
      notes = next;
      renderNotes();
    },
    dispose() {
      closeDraft();
      notes = [];
      renderNotes();
      for (const disposable of [layoutChange, mouseMove, mouseLeave, mouseDown, action]) disposable.dispose();
      hoverDecorations.clear();
    },
  };
}

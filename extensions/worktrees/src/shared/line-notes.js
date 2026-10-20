import { edgeScrollStep, orderLineRange } from './line-range.js';
import { monaco } from './monaco-setup.js';

const DRAFT_HEIGHT_PX = 150;
const NOTE_LINE_PX = 18;
const NOTE_CHROME_PX = 34;
const CARD_RIGHT_GAP_PX = 24;
const CONTENT_PROBE_INSET_PX = 4;

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
  isolateFromEditor(zone);
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
  let draftRange = null;
  let drag = null;
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
  const rangeDecorations = editor.createDecorationsCollection();

  const paintRange = (range) => {
    rangeDecorations.set(
      range
        ? [{ range: new monaco.Range(range.startLine, 1, range.endLine, 1), options: { isWholeLine: true, className: 'gx-note-range' } }]
        : []
    );
  };

  const closeDraft = () => {
    if (draftZoneId === null) return;
    editor.changeViewZones((accessor) => accessor.removeZone(draftZoneId));
    draftZoneId = null;
    draftRange = null;
    paintRange(null);
  };

  const openDraft = ({ startLine, endLine }) => {
    closeDraft();
    draftRange = { startLine, endLine };
    paintRange(draftRange);
    const card = element('div', 'gx-note-card gx-note-draft');
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
        const header = element('div', 'gx-note-header');
        const remove = element('button', 'gx-button gx-button-ghost gx-note-remove', '×');
        remove.title = 'Remove note';
        remove.addEventListener('click', () => onRemove(note.id));
        header.append(
          element('span', 'gx-note-label', rangeLabel(note.startLine, note.endLine)),
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

  const lineAtClientY = (clientY) => {
    const rect = domNode.getBoundingClientRect();
    const probeX = rect.left + editor.getLayoutInfo().contentLeft + CONTENT_PROBE_INSET_PX;
    const probeY = Math.max(rect.top + 1, Math.min(rect.bottom - 1, clientY));
    return editor.getTargetAtClientPoint(probeX, probeY)?.position?.lineNumber ?? null;
  };

  const followPointer = () => {
    const rect = domNode.getBoundingClientRect();
    const step = edgeScrollStep(rect.top, rect.bottom, drag.clientY);
    if (step !== 0) editor.setScrollTop(editor.getScrollTop() + step);
    drag.focusLine = lineAtClientY(drag.clientY) ?? drag.focusLine;
    paintRange(orderLineRange(drag.anchorLine, drag.focusLine));
    drag.frame = requestAnimationFrame(followPointer);
  };

  const onDragMove = (event) => {
    if (event.pointerId === drag.pointerId) drag.clientY = event.clientY;
  };
  const onDragEnd = (event) => {
    if (event.pointerId !== drag.pointerId) return;
    drag.focusLine = lineAtClientY(event.clientY) ?? drag.focusLine;
    finishDrag(event.type === 'pointerup');
  };
  const onDragKey = (event) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    finishDrag(false);
  };
  const dragListeners = [
    ['pointermove', onDragMove],
    ['pointerup', onDragEnd],
    ['pointercancel', onDragEnd],
    ['keydown', onDragKey],
  ];

  const finishDrag = (commit) => {
    if (!drag) return;
    const { anchorLine, focusLine, pointerId, frame } = drag;
    drag = null;
    cancelAnimationFrame(frame);
    for (const [type, listener] of dragListeners) document.removeEventListener(type, listener, true);
    if (domNode.hasPointerCapture(pointerId)) domNode.releasePointerCapture(pointerId);
    if (!commit) return paintRange(draftRange);
    openDraft(anchorLine === focusLine ? selectedLineRange(editor, anchorLine) : orderLineRange(anchorLine, focusLine));
  };

  // Capture phase on the editor node runs before Monaco's own gutter press handler.
  const onPointerDown = (event) => {
    if (drag || event.button !== 0 || event.ctrlKey || event.pointerType === 'touch') return;
    const target = editor.getTargetAtClientPoint(event.clientX, event.clientY);
    const line = target?.position?.lineNumber;
    if (target?.type !== monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN || !line) return;
    event.preventDefault();
    event.stopPropagation();
    hoverDecorations.clear();
    domNode.setPointerCapture(event.pointerId);
    for (const [type, listener] of dragListeners) document.addEventListener(type, listener, true);
    drag = { pointerId: event.pointerId, anchorLine: line, focusLine: line, clientY: event.clientY, frame: null };
    followPointer();
  };
  // Chromium still sends the compatibility mousedown after a cancelled pointerdown.
  const onMouseDownDuringDrag = (event) => {
    if (!drag) return;
    event.preventDefault();
    event.stopPropagation();
  };
  domNode.addEventListener('pointerdown', onPointerDown, true);
  domNode.addEventListener('mousedown', onMouseDownDuringDrag, true);

  const mouseMove = editor.onMouseMove((event) => {
    if (drag) return;
    const line = event.target.position?.lineNumber;
    hoverDecorations.set(
      line ? [{ range: new monaco.Range(line, 1, line, 1), options: { glyphMarginClassName: 'gx-note-add' } }] : []
    );
  });
  const mouseLeave = editor.onMouseLeave(() => hoverDecorations.clear());
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
      finishDrag(false);
      domNode.removeEventListener('pointerdown', onPointerDown, true);
      domNode.removeEventListener('mousedown', onMouseDownDuringDrag, true);
      closeDraft();
      notes = [];
      renderNotes();
      for (const disposable of [layoutChange, mouseMove, mouseLeave, action]) disposable.dispose();
      hoverDecorations.clear();
    },
  };
}

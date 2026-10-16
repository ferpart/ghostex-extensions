import { useEffect, useRef, useState } from 'preact/hooks';

export function timeAgo(iso) {
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  const steps = [
    [60, 's'],
    [60, 'm'],
    [24, 'h'],
    [30, 'd'],
    [12, 'mo'],
  ];
  let value = seconds;
  for (const [size, unit] of steps) {
    if (value < size) return unit === 's' ? 'just now' : `${Math.floor(value)}${unit} ago`;
    value /= size;
  }
  return `${Math.floor(value)}y ago`;
}

export function Menu({ label, title, items, class: className = 'gx-button gx-button-ghost', align = 'right' }) {
  const [open, setOpen] = useState(false);
  const root = useRef(null);
  useEffect(() => {
    if (!open) return;
    const close = (event) => !root.current?.contains(event.target) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  return (
    <div class="menu" ref={root}>
      <button class={className} title={title} onClick={() => setOpen(!open)}>
        {label}
      </button>
      {open && (
        <ul class={`menu-list menu-${align}`}>
          {items.filter(Boolean).map((item, index) =>
            item === 'separator' ? (
              <li key={index} class="menu-separator" />
            ) : (
              <li key={item.label}>
                <button
                  class="menu-item"
                  disabled={item.disabled}
                  title={item.title}
                  onClick={() => {
                    setOpen(false);
                    item.onSelect();
                  }}
                >
                  <span class="menu-check">{item.checked ? '✓' : ''}</span>
                  {item.label}
                </button>
              </li>
            )
          )}
        </ul>
      )}
    </div>
  );
}

export function ConfirmDialog({ request, onClose }) {
  if (!request) return null;
  const confirm = () => {
    onClose();
    request.action();
  };
  return (
    <div class="dialog-backdrop" onClick={onClose}>
      <div class="dialog" role="dialog" onClick={(event) => event.stopPropagation()}>
        <div class="dialog-title">{request.title}</div>
        {request.body && <div class="dialog-body">{request.body}</div>}
        <div class="dialog-actions">
          <button class="gx-button" onClick={onClose}>
            Cancel
          </button>
          <button class={`gx-button ${request.danger ? 'gx-button-danger' : 'gx-button-primary'}`} onClick={confirm}>
            {request.label}
          </button>
        </div>
      </div>
    </div>
  );
}

export function TextComposer({ placeholder, initialText = '', submitLabel, onSubmit, onCancel }) {
  const [text, setText] = useState(initialText);
  const [busy, setBusy] = useState(false);
  const input = useRef(null);
  useEffect(() => input.current?.focus(), []);
  const submit = async () => {
    setBusy(true);
    try {
      await onSubmit(text.trim());
    } finally {
      setBusy(false);
    }
  };
  return (
    <div class="composer">
      <textarea
        class="composer-input"
        placeholder={placeholder}
        value={text}
        ref={input}
        onInput={(event) => setText(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && text.trim()) submit();
          if (event.key === 'Escape') onCancel();
        }}
      />
      <div class="composer-actions">
        <span class="gx-muted">⌘↵ to send</span>
        <button class="gx-button" onClick={onCancel}>
          Cancel
        </button>
        <button class="gx-button gx-button-primary" disabled={busy || !text.trim()} onClick={submit}>
          {busy ? 'Sending…' : submitLabel}
        </button>
      </div>
    </div>
  );
}

import { useRef, useState } from 'preact/hooks';

export const Icon = ({ name, spin }) => <i class={`codicon codicon-${name}${spin ? ' codicon-modifier-spin' : ''}`} aria-hidden="true" />;

export function IconButton({ icon, title, onClick, disabled, spin }) {
  return (
    <button
      class="icon-button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
    >
      <Icon name={icon} spin={spin} />
    </button>
  );
}

export function LineCounts({ added, removed }) {
  return (
    <span class="line-counts">
      {added > 0 && <span class="added">+{added}</span>}
      {removed > 0 && <span class="removed">-{removed}</span>}
    </span>
  );
}

export function Section({ title, count, actions, children }) {
  const [open, setOpen] = useState(true);
  return (
    <section class="section">
      <header class="gx-section-header section-header" onClick={() => setOpen(!open)}>
        <Icon name={open ? 'chevron-down' : 'chevron-right'} />
        <span>{title.toUpperCase()}</span>
        <span class="gx-count">{count}</span>
        <span class="section-actions">{actions}</span>
      </header>
      {open && children}
    </section>
  );
}

export function FileRow({ entry, onOpen, actions }) {
  const slash = entry.path.lastIndexOf('/');
  const name = entry.path.slice(slash + 1);
  const dir = slash === -1 ? '' : entry.path.slice(0, slash);
  return (
    <li class="file-row" title={entry.oldPath ? `${entry.oldPath} → ${entry.path}` : entry.path} onClick={onOpen}>
      <span class="file-name">{name}</span>
      <span class="file-dir">{dir}</span>
      <span class="file-actions">{actions}</span>
      {entry.binary ? <span class="gx-muted">binary</span> : <LineCounts added={entry.added} removed={entry.removed} />}
      <span class={`status status-${entry.status === '!' ? 'conflict' : entry.status}`}>{entry.status}</span>
    </li>
  );
}

export function useConfirm() {
  const [request, setRequest] = useState(null);
  const resolver = useRef(null);
  const ask = (message, confirmLabel = 'Continue') =>
    new Promise((resolve) => {
      resolver.current = resolve;
      setRequest({ message, confirmLabel });
    });
  const answer = (value) => {
    resolver.current?.(value);
    setRequest(null);
  };
  const dialog = request && (
    <div class="confirm-backdrop" onClick={() => answer(false)}>
      <div class="confirm" role="dialog" onClick={(event) => event.stopPropagation()}>
        <p>{request.message}</p>
        <div class="confirm-actions">
          <button class="gx-button" onClick={() => answer(false)}>Cancel</button>
          <button class="gx-button gx-button-primary" ref={(node) => node?.focus()} onClick={() => answer(true)}>
            {request.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
  return { ask, dialog };
}

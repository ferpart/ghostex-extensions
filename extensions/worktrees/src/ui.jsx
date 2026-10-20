import { useEffect, useRef, useState } from 'preact/hooks';

export function timeAgo(timestamp) {
  const seconds = Math.max(0, (Date.now() - timestamp) / 1000);
  const steps = [
    [60, 'm'],
    [60, 'h'],
    [24, 'd'],
    [30, 'mo'],
    [12, 'y'],
  ];
  let value = seconds / 60;
  if (value < 1) return 'just now';
  for (const [size, unit] of steps) {
    if (value < size) return `${Math.floor(value)}${unit} ago`;
    value /= size;
  }
  return `${Math.floor(value)}y ago`;
}

const ICON_PATHS = {
  open: '<circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M13 6h3a2 2 0 0 1 2 2v7"/><path d="M6 9v12"/>',
  draft: '<circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M18 6h.01"/><path d="M6 9v12"/><path d="M18 9v6"/>',
  merged: '<circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M6 21V9a9 9 0 0 0 9 9"/>',
  closed: '<circle cx="6" cy="6" r="3"/><path d="M6 9v12"/><path d="m21 3-6 6"/><path d="m21 9-6-6"/><path d="M18 11.5V15"/><circle cx="18" cy="18" r="3"/>',
  none: '<circle cx="12" cy="12" r="3"/>',
};

export function PullRequestIcon({ state }) {
  return (
    <svg
      class={`pr-icon pr-${state}`}
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      dangerouslySetInnerHTML={{ __html: ICON_PATHS[state] }}
    />
  );
}

export function Menu({ label, title, items }) {
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
      <button class="gx-button gx-button-ghost icon-button" title={title} onClick={() => setOpen(!open)}>
        {label}
      </button>
      {open && (
        <ul class="menu-list">
          {items.filter(Boolean).map((item) => (
            <li key={item.label}>
              <button
                class="menu-item"
                disabled={item.disabled}
                onClick={() => {
                  setOpen(false);
                  item.onSelect();
                }}
              >
                {item.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

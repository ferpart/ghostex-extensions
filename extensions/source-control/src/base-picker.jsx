import { useEffect, useState } from 'preact/hooks';
import { listBranches } from './git.js';
import { Icon } from './ui.jsx';

const MAX_SHOWN = 200;

export function BasePicker({ cwd, base, defaultBase, isCustom, onPick, onClose }) {
  const [branches, setBranches] = useState(null);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    listBranches(cwd).then(setBranches).catch(setError);
  }, [cwd]);

  const needle = query.trim().toLowerCase();
  const matches = (branches ?? []).filter((branch) => branch.name.toLowerCase().includes(needle));
  const shown = matches.slice(0, MAX_SHOWN);

  return (
    <>
      <div class="menu-backdrop" onClick={onClose} />
      <div class="base-picker" role="dialog" aria-label="Choose the base branch">
        <input
          class="base-search"
          placeholder="Search branches"
          value={query}
          ref={(node) => node?.focus()}
          onInput={(event) => setQuery(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') onClose();
            if (event.key === 'Enter' && shown[0]) onPick(shown[0].name);
          }}
        />
        <ul class="base-list" role="listbox">
          <li>
            <button class="base-option" disabled={!isCustom} onClick={() => onPick(null)}>
              <Icon name="discard" />
              <span class="base-name">Reset to default{defaultBase ? ` (${defaultBase})` : ''}</span>
            </button>
          </li>
          {error && <li class="gx-error">{error.message}</li>}
          {!branches && !error && <li class="gx-muted base-note">Loading branches…</li>}
          {branches && matches.length === 0 && <li class="gx-muted base-note">No branch matches "{query}".</li>}
          {shown.map((branch) => (
            <li key={branch.name}>
              <button
                class={`base-option${branch.name === base ? ' current' : ''}`}
                role="option"
                aria-selected={branch.name === base}
                onClick={() => onPick(branch.name)}
              >
                <Icon name={branch.name === base ? 'check' : branch.remote ? 'cloud' : 'git-branch'} />
                <span class="base-name">{branch.name}</span>
                {branch.name === defaultBase && <span class="gx-muted">default</span>}
              </button>
            </li>
          ))}
          {matches.length > MAX_SHOWN && <li class="gx-muted base-note">{matches.length - MAX_SHOWN} more. Refine the search.</li>}
        </ul>
      </div>
    </>
  );
}

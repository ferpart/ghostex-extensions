import { useMemo } from 'preact/hooks';
import { fileIcon, Icon } from './icons.jsx';
import { STATUS_LETTER, visibleRows } from './tree.js';

const INDENT_PX = 14;

export function TreeView({ root, expanded, gitStatus, activePath, onToggle, onOpen }) {
  const rows = useMemo(() => visibleRows(root, expanded), [root, expanded]);
  if (rows.length === 0) return <div class="placeholder gx-muted">This folder has no files.</div>;
  return (
    <ul class="rows">
      {rows.map(({ node, depth }) => {
        const status = (node.isDir ? gitStatus.dirs : gitStatus.files).get(node.path);
        const isOpen = node.isDir && expanded.has(node.path);
        const classes = ['row', status && `st-${status}`, node.path === activePath && 'active'].filter(Boolean).join(' ');
        return (
          <li key={node.path}>
            <button
              class={classes}
              style={{ paddingLeft: `${6 + depth * INDENT_PX}px` }}
              title={node.path}
              onClick={() => (node.isDir ? onToggle(node.path) : onOpen({ path: node.path }))}
            >
              <span class="twisty">{node.isDir && <Icon name={isOpen ? 'chevron-down' : 'chevron-right'} />}</span>
              <Icon name={node.isDir ? (isOpen ? 'folder-opened' : 'folder') : fileIcon(node.name)} />
              <span class="name">{node.name}</span>
              {status && !node.isDir && <span class="status-letter">{STATUS_LETTER[status]}</span>}
              {status && node.isDir && <span class="status-dot">●</span>}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

const compareNames = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' }).compare;

export function splitNul(output) {
  const entries = output.split('\0');
  if (!output.endsWith('\0')) entries.pop();
  return entries.filter(Boolean);
}

const parentOf = (path) => {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? '' : path.slice(0, slash);
};

export function ancestorsOf(path) {
  const ancestors = [];
  for (let dir = parentOf(path); dir; dir = parentOf(dir)) ancestors.push(dir);
  return ancestors;
}

function ensureDir(dirs, path) {
  let dir = dirs.get(path);
  if (dir) return dir;
  dir = { name: path.slice(path.lastIndexOf('/') + 1), path, isDir: true, children: [] };
  ensureDir(dirs, parentOf(path)).children.push(dir);
  dirs.set(path, dir);
  return dir;
}

function sortChildren(dir) {
  dir.children.sort((a, b) => (a.isDir === b.isDir ? compareNames(a.name, b.name) : a.isDir ? -1 : 1));
  for (const child of dir.children) if (child.isDir) sortChildren(child);
}

export function buildTree(paths) {
  const root = { name: '', path: '', isDir: true, children: [] };
  const dirs = new Map([['', root]]);
  for (const path of new Set(paths)) {
    if (!path || dirs.has(path)) continue;
    ensureDir(dirs, parentOf(path)).children.push({ name: path.slice(path.lastIndexOf('/') + 1), path, isDir: false });
  }
  sortChildren(root);
  return root;
}

export function visibleRows(root, expanded) {
  const rows = [];
  const walk = (dir, depth) => {
    for (const node of dir.children) {
      rows.push({ node, depth });
      if (node.isDir && expanded.has(node.path)) walk(node, depth + 1);
    }
  };
  walk(root, 0);
  return rows;
}

const STATUS_PRIORITY = { conflict: 6, deleted: 5, modified: 4, added: 3, renamed: 2, untracked: 1 };
export const STATUS_LETTER = { conflict: '!', deleted: 'D', modified: 'M', added: 'A', renamed: 'R', untracked: 'U' };

function statusKind(xy) {
  if (xy.includes('U') || xy === 'AA' || xy === 'DD') return 'conflict';
  if (xy === '??') return 'untracked';
  if (xy.includes('D')) return 'deleted';
  if (xy.includes('R') || xy.includes('C')) return 'renamed';
  if (xy.includes('A')) return 'added';
  return 'modified';
}

export function parseGitStatus(output, prefix = '') {
  const files = new Map();
  const entries = splitNul(output);
  for (let i = 0; i < entries.length; i++) {
    const xy = entries[i].slice(0, 2);
    const path = entries[i].slice(3);
    if (xy[0] === 'R' || xy[0] === 'C') i++;
    if (xy === '!!' || !path.startsWith(prefix)) continue;
    files.set(path.slice(prefix.length), statusKind(xy));
  }
  const dirs = new Map();
  for (const [path, kind] of files) {
    for (const dir of ancestorsOf(path)) {
      const current = dirs.get(dir);
      if (current && STATUS_PRIORITY[current] >= STATUS_PRIORITY[kind]) break;
      dirs.set(dir, kind);
    }
  }
  return { files, dirs };
}

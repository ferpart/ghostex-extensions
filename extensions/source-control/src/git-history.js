const DECORATION_SEPARATOR = '\x1f';
const LEGACY_DECORATION_SEPARATOR = ',';

// Git before 2.43 prints %(decorate:...) verbatim, so %D is the fallback. Callers must pass --decorate=full.
export const LOG_FORMAT = '%H%n%aN%n%aE%n%at%n%ct%n%P%n%(decorate:prefix=,suffix=,separator=%x1f)%n%D%n%B';
const UNEXPANDED_DECORATE = `%(decorate:prefix=,suffix=,separator=${DECORATION_SEPARATOR})`;

export const REF_COLOR = 'ref';
export const REMOTE_REF_COLOR = 'remote-ref';
export const BASE_REF_COLOR = 'base-ref';
export const LANE_COLORS = ['lane-1', 'lane-2', 'lane-3', 'lane-4', 'lane-5'];

export function logCommand(limit) {
  return `git log --no-show-signature --no-color '--format=${LOG_FORMAT}' -z --topo-order --decorate=full -n${limit + 1} HEAD --`;
}

export const shortHash = (hash) => hash.slice(0, 7);

const CATEGORY_PREFIXES = [
  ['refs/heads/', 'branches'],
  ['refs/remotes/', 'remote branches'],
  ['refs/tags/', 'tags'],
];

export function refFromFullName(fullName, revision) {
  for (const [prefix, category] of CATEGORY_PREFIXES) {
    if (fullName.startsWith(prefix)) return { id: fullName, name: fullName.slice(prefix.length), revision, category };
  }
  return { id: fullName, name: shortHash(revision), revision, category: 'commits' };
}

const categoryRank = (ref) => {
  const index = CATEGORY_PREFIXES.findIndex(([prefix]) => ref.id.startsWith(prefix));
  return index === -1 ? 99 : index;
};

function parseDecorations(raw, revision, separator) {
  const refs = [];
  for (const part of raw.split(separator)) {
    let ref = part.trim();
    if (!ref || ref === 'HEAD' || /^refs\/remotes\/[^/]+\/HEAD(?:\s|$)/.test(ref)) continue;
    if (ref.startsWith('HEAD -> ')) ref = ref.slice('HEAD -> '.length);
    if (ref.startsWith('tag: ')) ref = ref.slice('tag: '.length);
    const parsed = refFromFullName(ref, revision);
    if (parsed.category !== 'commits') refs.push(parsed);
  }
  return refs.sort((a, b) => categoryRank(a) - categoryRank(b) || a.name.localeCompare(b.name));
}

export function parseLog(stdout) {
  const items = [];
  for (const rawRecord of stdout.split('\0')) {
    const record = rawRecord.replace(/^\n+/, '');
    if (!record.trim()) continue;
    const lines = [];
    let messageStart = 0;
    for (let field = 0; field < 8; field += 1) {
      const newline = record.indexOf('\n', messageStart);
      if (newline === -1) {
        lines.push(record.slice(messageStart));
        messageStart = record.length;
        break;
      }
      lines.push(record.slice(messageStart, newline));
      messageStart = newline + 1;
    }
    const hash = lines[0]?.trim() ?? '';
    if (!/^[0-9a-fA-F]{40,64}$/.test(hash)) continue;
    const isLegacyGit = lines[6] === UNEXPANDED_DECORATE;
    const message = record.slice(messageStart).replace(/\n$/, '');
    const authorSeconds = Number.parseInt(lines[3] ?? '', 10);
    const parents = (lines[5] ?? '').trim();
    items.push({
      id: hash,
      parentIds: parents ? parents.split(' ') : [],
      subject: message.split(/\r?\n/, 1)[0]?.trim() || '(no commit message)',
      message,
      author: lines[1] || undefined,
      displayId: shortHash(hash),
      timestamp: Number.isFinite(authorSeconds) ? authorSeconds * 1000 : undefined,
      references: parseDecorations(
        (isLegacyGit ? lines[7] : lines[6]) ?? '',
        hash,
        isLegacyGit ? LEGACY_DECORATION_SEPARATOR : DECORATION_SEPARATOR
      ),
    });
  }
  return items;
}

const cloneNode = (node) => ({ id: node.id, color: node.color });

function resolveNodeColor(id, hasParents, inputLanes, outputLanes) {
  const inputIndex = inputLanes.findIndex((node) => node.id === id);
  const circleIndex = inputIndex !== -1 ? inputIndex : inputLanes.length;
  // A root ends its own lane, so its output slot may belong to another history.
  if (!hasParents && inputIndex !== -1) return inputLanes[inputIndex].color;
  return outputLanes[circleIndex]?.color ?? inputLanes[circleIndex]?.color ?? REF_COLOR;
}

function labelColor(item, colorMap) {
  for (const ref of item.references ?? []) {
    const color = colorMap.get(ref.id);
    if (color !== undefined) return color;
  }
  return undefined;
}

export function buildColorMap({ currentRef, remoteRef, baseRef }) {
  const colorMap = new Map();
  if (currentRef) colorMap.set(currentRef, REF_COLOR);
  if (remoteRef) colorMap.set(remoteRef, REMOTE_REF_COLOR);
  if (baseRef) colorMap.set(baseRef, BASE_REF_COLOR);
  return colorMap;
}

export function buildGraphRows(items, colorMap = new Map(), headId) {
  let colorIndex = -1;
  const rows = [];
  const itemsById = new Map();
  for (const item of items) if (!itemsById.has(item.id)) itemsById.set(item.id, item);

  for (const item of items) {
    const firstParentId = item.parentIds[0];
    const inputLanes = (rows.at(-1)?.outputLanes ?? []).map(cloneNode);
    const outputLanes = [];
    let firstParentAdded = false;

    for (const node of inputLanes) {
      if (node.id === item.id) {
        if (!firstParentAdded && firstParentId !== undefined) {
          outputLanes.push({ id: firstParentId, color: labelColor(item, colorMap) ?? node.color });
          firstParentAdded = true;
        }
        continue;
      }
      outputLanes.push(cloneNode(node));
    }

    for (let index = firstParentAdded ? 1 : 0; index < item.parentIds.length; index += 1) {
      const source = index === 0 ? item : itemsById.get(item.parentIds[index]);
      let color = source ? labelColor(source, colorMap) : undefined;
      if (!color) {
        colorIndex = (colorIndex + 1) % LANE_COLORS.length;
        color = LANE_COLORS[colorIndex];
      }
      outputLanes.push({ id: item.parentIds[index], color });
    }

    const references = (item.references ?? []).map((ref) => ({
      ...ref,
      color: colorMap.has(ref.id)
        ? (colorMap.get(ref.id) ?? resolveNodeColor(item.id, firstParentId !== undefined, inputLanes, outputLanes))
        : undefined,
    }));

    rows.push({ item: { ...item, references }, isHead: item.id === headId, inputLanes, outputLanes });
  }
  return rows;
}

export function nodeColor(row) {
  return resolveNodeColor(row.item.id, row.item.parentIds.length > 0, row.inputLanes, row.outputLanes);
}

export function laneIndex(row) {
  const inputIndex = row.inputLanes.findIndex((node) => node.id === row.item.id);
  return inputIndex !== -1 ? inputIndex : row.inputLanes.length;
}

export function mergeParentLaneIndex(row, parentId) {
  for (let index = row.outputLanes.length - 1; index >= 0; index -= 1) {
    if (row.outputLanes[index].id === parentId) return index;
  }
  return -1;
}

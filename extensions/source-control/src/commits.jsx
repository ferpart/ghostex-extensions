import { useState } from 'preact/hooks';
import { laneIndex, mergeParentLaneIndex, nodeColor } from './git-history.js';
import { loadCommitFiles } from './git.js';
import { FileRow, Icon, Section } from './ui.jsx';

const LANE_HEIGHT = 24;
const LANE_WIDTH = 11;
const CURVE_RADIUS = 5;
const NODE_Y = LANE_HEIGHT / 2;
const CIRCLE_RADIUS = 3.5;

const graphColor = (color) => `var(--graph-${color})`;

function lanePaths(row) {
  const { item, inputLanes, outputLanes } = row;
  const circleIndex = laneIndex(row);
  const inputIndex = inputLanes.findIndex((node) => node.id === item.id);
  const x = (index) => LANE_WIDTH * (index + 1);
  const paths = [];
  let outputIndex = 0;

  inputLanes.forEach((node, index) => {
    if (node.id === item.id) {
      if (index !== circleIndex) {
        paths.push([node.color, `M ${x(index)} 0 A ${LANE_WIDTH} ${LANE_WIDTH} 0 0 1 ${LANE_WIDTH * index} ${NODE_Y} H ${x(circleIndex)}`]);
      } else if (item.parentIds.length > 0) {
        outputIndex += 1;
      }
      return;
    }
    if (outputIndex < outputLanes.length && node.id === outputLanes[outputIndex].id) {
      if (index === outputIndex) {
        paths.push([node.color, `M ${x(index)} 0 V ${LANE_HEIGHT}`]);
      } else {
        paths.push([
          node.color,
          `M ${x(index)} 0 V 6 A ${CURVE_RADIUS} ${CURVE_RADIUS} 0 0 1 ${x(index) - CURVE_RADIUS} ${NODE_Y} ` +
            `H ${x(outputIndex) + CURVE_RADIUS} A ${CURVE_RADIUS} ${CURVE_RADIUS} 0 0 0 ${x(outputIndex)} ${NODE_Y + CURVE_RADIUS} V ${LANE_HEIGHT}`,
        ]);
      }
      outputIndex += 1;
    }
  });

  for (const parentId of item.parentIds.slice(1)) {
    const parentIndex = mergeParentLaneIndex(row, parentId);
    if (parentIndex === -1) continue;
    paths.push([
      outputLanes[parentIndex].color,
      `M ${LANE_WIDTH * parentIndex} ${NODE_Y} A ${LANE_WIDTH} ${LANE_WIDTH} 0 0 1 ${x(parentIndex)} ${LANE_HEIGHT} M ${LANE_WIDTH * parentIndex} ${NODE_Y} H ${x(circleIndex)}`,
    ]);
  }
  if (inputIndex !== -1) paths.push([inputLanes[inputIndex].color, `M ${x(circleIndex)} 0 V ${NODE_Y}`]);
  if (item.parentIds.length > 0) paths.push([nodeColor(row), `M ${x(circleIndex)} ${NODE_Y} V ${LANE_HEIGHT}`]);
  return paths;
}

export function graphWidth(row) {
  return LANE_WIDTH * (Math.max(row.inputLanes.length, row.outputLanes.length, 1) + 1);
}

function GraphSvg({ row }) {
  const cx = LANE_WIDTH * (laneIndex(row) + 1);
  const color = graphColor(nodeColor(row));
  const width = graphWidth(row);
  return (
    <svg class="graph" width={width} height={LANE_HEIGHT} viewBox={`0 0 ${width} ${LANE_HEIGHT}`} aria-hidden="true">
      {lanePaths(row).map(([laneColor, d], index) => (
        <path key={index} d={d} fill="none" stroke={graphColor(laneColor)} stroke-linecap="round" stroke-width="1" />
      ))}
      {row.isHead ? (
        <>
          <circle cx={cx} cy={NODE_Y} r={CIRCLE_RADIUS + 3} fill={color} stroke="var(--gx-bg)" stroke-width="1.5" />
          <circle cx={cx} cy={NODE_Y} r="1.5" fill="var(--gx-bg)" />
        </>
      ) : row.item.parentIds.length > 1 ? (
        <>
          <circle cx={cx} cy={NODE_Y} r={CIRCLE_RADIUS + 1} fill={color} />
          <circle cx={cx} cy={NODE_Y} r={CIRCLE_RADIUS - 1.5} fill="var(--gx-bg)" />
        </>
      ) : (
        <circle cx={cx} cy={NODE_Y} r={CIRCLE_RADIUS} fill={color} />
      )}
    </svg>
  );
}

function LaneContinuation({ row }) {
  return (
    <div class="lane-continuation" style={{ width: `${graphWidth(row)}px` }}>
      {row.outputLanes.map((node, index) => (
        <span key={index} style={{ left: `${LANE_WIDTH * (index + 1) - 0.5}px`, background: graphColor(node.color) }} />
      ))}
    </div>
  );
}

function CommitRow({ cwd, row, onOpenFile }) {
  const [files, setFiles] = useState(null);
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState(null);
  const { item } = row;

  const toggle = () => {
    setExpanded(!expanded);
    if (!expanded && !files) loadCommitFiles(cwd, item).then(setFiles).catch(setError);
  };

  return (
    <li class="commit">
      <button class="commit-row" title={`${item.displayId} · ${item.author ?? ''}\n\n${item.message}`} onClick={toggle}>
        <GraphSvg row={row} />
        <Icon name={expanded ? 'chevron-down' : 'chevron-right'} />
        <span class="commit-subject">{item.subject}</span>
        {item.references.map((ref) => (
          <span
            key={ref.id}
            class={`ref-label ${ref.category === 'tags' ? 'tag' : ''}`}
            style={ref.color ? { color: graphColor(ref.color), borderColor: graphColor(ref.color) } : undefined}
          >
            {ref.category === 'tags' && <Icon name="tag" />}
            {ref.name}
          </span>
        ))}
      </button>
      {expanded && (
        <div class="commit-details">
          <LaneContinuation row={row} />
          <div class="commit-details-body">
            <div class="gx-muted">
              {item.displayId} · {item.author} · {item.timestamp ? new Date(item.timestamp).toLocaleString() : ''}
            </div>
            {error && <div class="gx-error">{error.message}</div>}
            {!files && !error && <div class="gx-muted">Loading files…</div>}
            {files?.length === 0 && <div class="gx-muted">No file changes.</div>}
            <ul class="file-list">
              {files?.map((entry) => (
                <FileRow
                  key={entry.path}
                  entry={entry}
                  onOpen={() =>
                    onOpenFile({
                      key: `commit:${item.id}:${entry.path}`,
                      label: `${item.displayId}^ ↔ ${item.displayId}`,
                      entry,
                      original: { rev: item.parentIds[0] ?? null, path: entry.oldPath ?? entry.path },
                      modified: { rev: item.id, path: entry.path },
                    })
                  }
                />
              ))}
            </ul>
          </div>
        </div>
      )}
    </li>
  );
}

export function CommitsSection({ cwd, history, onLoadMore, onOpenFile }) {
  const rows = history?.rows ?? [];
  return (
    <Section title="Commits" count={history ? `${rows.length}${history.hasMore ? '+' : ''}` : '…'}>
      {!history && <div class="gx-muted section-note">Loading history…</div>}
      {history && rows.length === 0 && <div class="gx-muted section-note">No commits yet.</div>}
      <ul class="commit-list">
        {rows.map((row) => (
          <CommitRow key={row.item.id} cwd={cwd} row={row} onOpenFile={onOpenFile} />
        ))}
      </ul>
      {history?.hasMore && (
        <button class="gx-button gx-button-ghost load-more" onClick={onLoadMore}>
          Load more commits
        </button>
      )}
    </Section>
  );
}

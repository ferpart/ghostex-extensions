import { fileIcon, Icon } from './icons.jsx';
import { MAX_CONTENT_MATCHES } from './rg-json.js';

const PREVIEW_LEAD_CHARS = 30;

export function NameResults({ ranked, gitStatus, onOpen }) {
  if (ranked.total === 0) return <div class="placeholder gx-muted">No file names match.</div>;
  return (
    <>
      <div class="result-summary gx-muted">
        {ranked.total > ranked.results.length ? `${ranked.results.length} of ${ranked.total} files. Type more to narrow.` : `${ranked.total} files`}
      </div>
      <ul class="rows">
        {ranked.results.map(({ path }) => {
          const slash = path.lastIndexOf('/');
          const status = gitStatus.files.get(path);
          return (
            <li key={path}>
              <button class={status ? `row st-${status}` : 'row'} title={path} onClick={() => onOpen({ path })}>
                <Icon name={fileIcon(path)} />
                <span class="name">{path.slice(slash + 1)}</span>
                <span class="dir gx-muted">{slash === -1 ? '' : path.slice(0, slash)}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}

function Preview({ text, ranges }) {
  const [firstStart] = ranges[0] ?? [0];
  const indent = text.length - text.trimStart().length;
  const offset = Math.min(firstStart, Math.max(indent, firstStart - PREVIEW_LEAD_CHARS));
  const parts = [];
  let cursor = offset;
  for (const [start, end] of ranges) {
    if (end <= cursor) continue;
    parts.push(text.slice(cursor, Math.max(cursor, start)), <mark>{text.slice(Math.max(cursor, start), end)}</mark>);
    cursor = end;
  }
  parts.push(text.slice(cursor));
  return <span class="preview">{offset > indent && '…'}{parts}</span>;
}

export function ContentResults({ search, onOpen }) {
  if (search.status === 'searching' && !search.result) return <div class="placeholder gx-muted">Searching…</div>;
  if (search.status === 'error') return <div class="gx-error">{search.message}</div>;
  if (!search.result) return null;
  const { files, totalMatches, truncated } = search.result;
  if (totalMatches === 0) return <div class="placeholder gx-muted">No results.</div>;
  return (
    <>
      <div class="result-summary gx-muted">
        {totalMatches} matches in {files.length} files
        {truncated && ` (stopped at ${MAX_CONTENT_MATCHES} matches or the output limit)`}
        {search.status === 'searching' && ' · searching…'}
      </div>
      <ul class="rows">
        {files.map((file) => (
          <li key={file.path} class="result-file">
            <button class="row" title={file.path} onClick={() => onOpen({ path: file.path, line: file.matches[0].line })}>
              <Icon name={fileIcon(file.path)} />
              <span class="name">{file.path.slice(file.path.lastIndexOf('/') + 1)}</span>
              <span class="dir gx-muted">{file.path.slice(0, Math.max(0, file.path.lastIndexOf('/')))}</span>
              <span class="gx-count">{file.matches.length}</span>
            </button>
            <ul>
              {file.matches.map((match) => (
                <li key={match.line}>
                  <button class="row match" onClick={() => onOpen({ path: file.path, line: match.line })}>
                    <span class="line-number gx-muted">{match.line}</span>
                    <Preview text={match.text} ranges={match.ranges} />
                  </button>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </>
  );
}

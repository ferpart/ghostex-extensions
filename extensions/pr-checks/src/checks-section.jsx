import { useEffect, useRef, useState } from 'preact/hooks';
import { checkKey, checkStatusLabel, getBrokenChecks, isBrokenCheck, isPendingCheck, summarizeChecks, summaryText } from './checks.js';

function statusIcon(check) {
  if (check.conclusion === 'success') return <span class="status status-success">✓</span>;
  if (isBrokenCheck(check) || check.conclusion === 'action_required') return <span class="status status-failure">✗</span>;
  if (isPendingCheck(check)) return <span class="status status-pending">●</span>;
  return <span class="status status-neutral">–</span>;
}

function CheckLog({ check, log }) {
  const pre = useRef(null);
  useEffect(() => {
    if (pre.current) pre.current.scrollTop = pre.current.scrollHeight;
  }, [log?.text]);
  if (!check.isActions) {
    return <div class="check-log-note gx-muted">This check does not run on GitHub Actions. Open the check page to see its output.</div>;
  }
  if (!log || log.loading) return <div class="check-log-note gx-muted">Loading the last 150 log lines…</div>;
  if (log.error) return <div class="gx-error">Could not load the log: {log.error}</div>;
  if (!log.text.trim()) return <div class="check-log-note gx-muted">The log is empty.</div>;
  return (
    <pre class="check-log" ref={pre}>
      {log.text}
    </pre>
  );
}

function CheckRow({ check, log, onExpand, onFix, onOpen, busy }) {
  const [expanded, setExpanded] = useState(false);
  const broken = isBrokenCheck(check);
  const toggle = () => {
    if (!broken) return;
    if (!expanded) onExpand(check);
    setExpanded(!expanded);
  };
  return (
    <li class="check">
      <div class={broken ? 'check-row expandable' : 'check-row'} onClick={toggle}>
        <span class="chevron">{broken ? (expanded ? '▾' : '▸') : ''}</span>
        {statusIcon(check)}
        <span class="check-name" title={check.name}>
          {check.name}
        </span>
        <span class="check-status gx-muted">{checkStatusLabel(check)}</span>
        {broken && (
          <button
            class="gx-button gx-button-small"
            disabled={busy}
            title="Send this failure to the agent"
            onClick={(event) => {
              event.stopPropagation();
              onFix([check]);
            }}
          >
            Fix
          </button>
        )}
        {check.url && (
          <button
            class="gx-button gx-button-ghost icon-button"
            title="Open the check page"
            onClick={(event) => {
              event.stopPropagation();
              onOpen(check.url);
            }}
          >
            ↗
          </button>
        )}
      </div>
      {expanded && <CheckLog check={check} log={log} />}
    </li>
  );
}

function checkRank(check) {
  if (isBrokenCheck(check) || check.conclusion === 'action_required') return 0;
  return isPendingCheck(check) ? 1 : 2;
}

export function ChecksSection({ checks: unsortedChecks, logs, busy, onLoadLog, onFix, onRerun, onOpen }) {
  const [collapsed, setCollapsed] = useState(false);
  const checks = [...unsortedChecks].sort((a, b) => checkRank(a) - checkRank(b));
  const summary = summarizeChecks(checks);
  const broken = getBrokenChecks(checks);
  return (
    <section class="checks">
      <header class="checks-summary">
        <button class="gx-button gx-button-ghost summary-toggle" onClick={() => setCollapsed(!collapsed)}>
          <span class="chevron">{collapsed ? '▸' : '▾'}</span>
          {summary.failing ? (
            <span class="status status-failure">✗</span>
          ) : summary.pending ? (
            <span class="status status-pending">●</span>
          ) : (
            <span class="status status-success">✓</span>
          )}
          <span>{summaryText(summary)}</span>
        </button>
        {broken.length > 0 && (
          <span class="checks-actions">
            <button class="gx-button gx-button-small" disabled={busy} onClick={onRerun} title="Re-run the failed jobs on GitHub">
              Re-run failed
            </button>
            <button class="gx-button gx-button-small gx-button-primary" disabled={busy} onClick={() => onFix(broken)}>
              Fix all failing
            </button>
          </span>
        )}
      </header>
      {!collapsed && checks.length === 0 && <div class="empty gx-muted">GitHub reports no checks for the head commit.</div>}
      {!collapsed && checks.length > 0 && (
        <ul class="check-list">
          {checks.map((check) => (
            <CheckRow key={checkKey(check)} check={check} log={logs[checkKey(check)]} busy={busy} onExpand={onLoadLog} onFix={onFix} onOpen={onOpen} />
          ))}
        </ul>
      )}
    </section>
  );
}

import { useState } from 'preact/hooks';
import { audienceCounts, filterByAudience, groupRoot, isBotComment } from './comments.js';
import { Menu, TextComposer, timeAgo } from './ui.jsx';

const REACTIONS = {
  THUMBS_UP: '👍',
  THUMBS_DOWN: '👎',
  LAUGH: '😄',
  HOORAY: '🎉',
  CONFUSED: '😕',
  HEART: '❤️',
  ROCKET: '🚀',
  EYES: '👀',
};

const AUDIENCES = [
  ['all', 'All'],
  ['human', 'Humans'],
  ['bot', 'Bots'],
];

function quoteFor(comment) {
  const quoted = comment.body.split('\n').slice(0, 3).map((line) => `> ${line}`).join('\n');
  return `@${comment.author} wrote:\n${quoted}\n\n`;
}

function Avatar({ comment }) {
  const [failed, setFailed] = useState(false);
  if (!comment.authorAvatarUrl || failed) return <span class="avatar avatar-fallback">{comment.author[0]?.toUpperCase()}</span>;
  return <img class="avatar" src={comment.authorAvatarUrl} alt="" onError={() => setFailed(true)} />;
}

function Reactions({ comment, busy, onReact }) {
  return (
    <div class="reactions">
      {comment.reactions.map((reaction) => (
        <button
          key={reaction.content}
          class={reaction.viewerHasReacted ? 'reaction reacted' : 'reaction'}
          disabled={busy}
          title={reaction.viewerHasReacted ? 'Remove your reaction' : 'Add this reaction'}
          onClick={() => onReact(comment, reaction.content, !reaction.viewerHasReacted)}
        >
          {REACTIONS[reaction.content] ?? reaction.content} {reaction.count}
        </button>
      ))}
      <Menu
        label="☺+"
        title="Add a reaction"
        class="reaction reaction-add"
        align="left"
        items={Object.entries(REACTIONS).map(([content, emoji]) => {
          const mine = comment.reactions.some((reaction) => reaction.content === content && reaction.viewerHasReacted);
          return { label: emoji, checked: mine, disabled: busy, onSelect: () => onReact(comment, content, !mine) };
        })}
      />
    </div>
  );
}

function CommentBody({ comment, busy, onReact }) {
  return (
    <>
      {comment.bodyHTML ? (
        <div class="comment-body" dangerouslySetInnerHTML={{ __html: comment.bodyHTML }} />
      ) : (
        <div class="comment-body gx-muted">No text.</div>
      )}
      <Reactions comment={comment} busy={busy} onReact={onReact} />
    </>
  );
}

function CommentMeta({ comment }) {
  return (
    <span class="comment-meta">
      <span class="comment-author">{comment.author}</span>
      <span class="gx-muted" title={new Date(comment.createdAt).toLocaleString()}>
        {timeAgo(comment.createdAt)}
      </span>
      {isBotComment(comment) && <span class="tag">BOT</span>}
    </span>
  );
}

function lineLabel(comment) {
  if (!comment.line) return '';
  return comment.startLine && comment.startLine !== comment.line ? `:${comment.startLine}-${comment.line}` : `:${comment.line}`;
}

function CommentCard({ group, selected, busy, onToggleSelect, actions }) {
  const root = groupRoot(group);
  const replies = group.kind === 'thread' ? group.replies : [];
  const [expanded, setExpanded] = useState(!root.isResolved);
  const [replying, setReplying] = useState(false);
  const { onReact, onReply, onResolve, onSendToAgent, onOpen } = actions;

  return (
    <li class={root.isResolved ? 'comment-card resolved' : 'comment-card'}>
      <header class="comment-header">
        <input type="checkbox" checked={selected} title="Select to send to the agent" onChange={() => onToggleSelect(group.id)} />
        <Avatar comment={root} />
        <CommentMeta comment={root} />
        {root.isResolved && (
          <button class="tag tag-button" onClick={() => setExpanded(!expanded)}>
            {expanded ? 'Resolved ▾' : 'Resolved ▸'}
          </button>
        )}
        {root.isOutdated && <span class="tag">OUTDATED</span>}
        <Menu
          label="⋯"
          title="Comment actions"
          items={[
            { label: 'Send to agent', disabled: busy, onSelect: () => onSendToAgent([group]) },
            { label: 'Reply', onSelect: () => setReplying(true) },
            group.kind === 'thread' && {
              label: root.isResolved ? 'Unresolve thread' : 'Resolve thread',
              disabled: busy,
              onSelect: () => onResolve(group, !root.isResolved),
            },
            { label: 'Open on GitHub', onSelect: () => onOpen(root.url) },
          ]}
        />
      </header>
      {root.path && (
        <div class="comment-path" title={root.path}>
          {root.path}
          {lineLabel(root)}
        </div>
      )}
      {expanded && (
        <>
          <CommentBody comment={root} busy={busy} onReact={onReact} />
          {replies.map((reply) => (
            <div key={reply.nodeId} class="comment-reply">
              <div class="comment-header">
                <Avatar comment={reply} />
                <CommentMeta comment={reply} />
              </div>
              <CommentBody comment={reply} busy={busy} onReact={onReact} />
            </div>
          ))}
          <div class="comment-actions">
            <button class="gx-button gx-button-small" onClick={() => setReplying(true)}>
              Reply
            </button>
            {group.kind === 'thread' && (
              <button class="gx-button gx-button-small" disabled={busy} onClick={() => onResolve(group, !root.isResolved)}>
                {root.isResolved ? 'Unresolve' : 'Resolve'}
              </button>
            )}
            <button class="gx-button gx-button-small" disabled={busy} onClick={() => onSendToAgent([group])}>
              Send to agent
            </button>
          </div>
        </>
      )}
      {replying && (
        <TextComposer
          placeholder={group.kind === 'thread' ? 'Reply to this thread' : 'Reply with a new PR comment'}
          initialText={group.kind === 'thread' ? '' : quoteFor(root)}
          submitLabel="Reply"
          onCancel={() => setReplying(false)}
          onSubmit={async (body) => {
            if (await onReply(group, body)) setReplying(false);
          }}
        />
      )}
    </li>
  );
}

export function CommentsSection({ groups, busy, actions }) {
  const [audience, setAudience] = useState('all');
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [composing, setComposing] = useState(false);
  const counts = audienceCounts(groups, groupRoot);
  const shown = filterByAudience(groups, audience, groupRoot);
  const selected = groups.filter((group) => selectedIds.has(group.id));

  const toggleSelect = (id) => {
    const next = new Set(selectedIds);
    if (!next.delete(id)) next.add(id);
    setSelectedIds(next);
  };
  const sendSelected = async () => {
    if (await actions.onSendToAgent(selected)) setSelectedIds(new Set());
  };

  return (
    <section class="comments">
      <header class="gx-section-header comments-header">
        <span>COMMENTS</span>
        <span class="gx-count">{groups.length}</span>
        <span class="comments-header-actions">
          {selected.length > 0 && (
            <button class="gx-button gx-button-small gx-button-primary" disabled={busy} onClick={sendSelected}>
              Send {selected.length} to agent
            </button>
          )}
          {shown.length > 0 && (
            <button
              class="gx-button gx-button-small"
              onClick={() => setSelectedIds(selected.length === shown.length ? new Set() : new Set(shown.map((group) => group.id)))}
            >
              {selected.length === shown.length ? 'Clear selection' : 'Select all'}
            </button>
          )}
          <button class="gx-button gx-button-ghost icon-button" title="Add a PR comment" onClick={() => setComposing(true)}>
            +
          </button>
        </span>
      </header>
      <div class="tabs" role="tablist">
        {AUDIENCES.map(([key, label]) => (
          <button key={key} role="tab" class={audience === key ? 'tab active' : 'tab'} onClick={() => setAudience(key)}>
            {label} {counts[key]}
          </button>
        ))}
      </div>
      {composing && (
        <TextComposer
          placeholder="Add a comment to the PR"
          submitLabel="Comment"
          onCancel={() => setComposing(false)}
          onSubmit={async (body) => {
            if (await actions.onAddComment(body)) setComposing(false);
          }}
        />
      )}
      {shown.length === 0 && <div class="empty gx-muted">{groups.length === 0 ? 'No comments on this PR.' : 'No comments in this tab.'}</div>}
      <ul class="comment-list">
        {shown.map((group) => (
          <CommentCard
            key={group.id}
            group={group}
            selected={selectedIds.has(group.id)}
            busy={busy}
            onToggleSelect={toggleSelect}
            actions={actions}
          />
        ))}
      </ul>
    </section>
  );
}

# PR Checks

Manage the pull request of the current branch: checks, merge, and comments. Send failures or review feedback to the active agent.

## Features

- PR header: number, state (OPEN, DRAFT, MERGED, CLOSED), title, and update time. The menu opens the PR, copies the URL, marks it ready or converts it to a draft, and closes or reopens it.
- Create PR (`gh pr create --fill`) or a draft PR when the branch has no PR.
- Merge split button: merge commit, squash, or rebase, and auto-merge. The button is off when GitHub says the PR cannot merge, and the panel shows the reason. Each merge asks for confirmation.
- Checks: a summary row, one row per check run or commit status, and the last 150 log lines of a failed GitHub Actions job. Re-run failed jobs, send one failure to the agent, or send all failures.
- Comments: All, Humans, and Bots tabs. Reactions, replies, resolve and unresolve, and new PR comments. Select comments and send them to the agent.
- Refresh on focus, on a project or branch change, and every 60 seconds while checks are pending.
- Top-bar badge with the check summary, for example `✓7` or `✗2 ●1`.

## Permissions

- `exec`: runs `git` and `gh` in the project folder, and `open` for links.
- `cli`: sends prompts to the active agent session with `ghostex send-session-chat-message`.

## Self-checks

```sh
node src/checks.selftest.mjs
node src/comments.selftest.mjs
```

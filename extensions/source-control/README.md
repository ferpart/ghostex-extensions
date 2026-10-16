# Source Control

Stage, commit, push, and review branch changes and history, with line notes for the active agent.

## Features

- Branch header: pull request link, branch, upstream (or base branch), ahead and behind counts, total changed lines of the branch, and an open-in-browser button.
- Commit box: message, a sparkle button that writes the message from the staged diff with `claude` or `codex`, and a Commit split button (Commit, Commit & Push, Commit & Sync, Amend, Push, Pull, Fetch, Publish branch).
- Staged changes and Changes: stage, unstage, and discard each file, or stage and unstage all.
- Committed on branch: files changed since the merge base with `origin/HEAD` (or `main` / `master`).
- Commits: history with a commit graph, branch and tag labels, the files of each commit, and "Load more commits".
- Diff view: click a file to open an inline Monaco diff. Add line notes in the gutter and send them to the active agent.

Push, pull, publish, amend, and discard ask for confirmation first. Pull and sync use `git pull --ff-only`.

## Preferences

- `agent`: the CLI that writes commit messages (`claude` or `codex`).
- `model`: optional model for that CLI, for example `haiku`.

## Permissions

- `exec`: runs `git`, `gh`, and the commit message agent CLI in the project folder.
- `cli`: sends notes to the active agent session with `ghostex send-session-chat-message` and `ghostex queue-session-chat-prompt`.

## Self-checks

```sh
node src/git-parse.selftest.mjs
node src/git-history.selftest.mjs
node src/commit-prompt.selftest.mjs
```

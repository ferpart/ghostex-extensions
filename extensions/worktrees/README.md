# Worktrees

See which git worktrees are safe to delete. The extension lists the worktrees of every repo that has a Ghostex project, with the pull request state of each branch.

## Features

- One group for each repo. One row for each worktree: PR state icon, branch, folder, PR number, uncommitted file count, unpushed commit count, and last commit age.
- PR icon colors: open green, draft gray, merged purple, closed red, no PR muted. The PR number opens in the browser.
- "Can delete" mark: the PR is merged or closed, the worktree has no uncommitted changes, and no commit is missing from the remote or the PR. The main worktree of a repo never gets the mark.
- Filters: All, Can delete, and Open PRs (open and draft). A refresh button. The list also refreshes when the page gets focus.
- Row menu: Open project (switches the Ghostex project), Copy path, and Reveal in Finder.
- Worktrees that are not Ghostex projects have a "no project" tag. Worktrees and projects with a missing folder have a "folder missing" tag.
- Top-bar badge with the number of worktrees that can be deleted, for example `🗑 3`.

The extension has no delete action. Delete a worktree with Delete Worktree on its project in the Ghostex sidebar.

## How it works

- `ghostex state` gives the project list. If it fails, the extension shows the open project only.
- `git rev-parse --git-common-dir` groups the projects by repo. `git worktree list --porcelain` lists every worktree of the repo.
- One `gh pr list --state all --limit 200` call for each repo gives the PRs. The newest PR of a branch wins. PRs from forks are ignored. The extension caches the PR list of each repo for 60 seconds. The refresh button skips the cache.
- A commit counts as unpushed when no remote-tracking branch contains it and it is not part of the PR head commit. A repo with more than 200 PRs may show an old branch without a PR. Such a worktree never gets the "Can delete" mark.
- Git commands run six at a time.

## Permissions

- `exec`: runs `git` and `gh`, and `open` for links and Finder.
- `cli`: runs `ghostex state` and `ghostex switch-project`.

## Self-checks

```sh
node src/worktrees.selftest.mjs
```

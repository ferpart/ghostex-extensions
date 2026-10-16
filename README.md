# Ghostex extensions

Three [Ghostex](https://github.com/maddada/Ghostex) extensions that bring the Orca right sidebar to Ghostex:

| Extension | What it does |
|---|---|
| [Explorer](extensions/explorer) | Browse and search project files, open them in Monaco, and add line notes for the agent. |
| [Source Control](extensions/source-control) | Stage, commit, push, and review branch changes and history, with line notes on diffs. |
| [PR Checks](extensions/pr-checks) | Manage the branch pull request: checks, merge, comments. Send failing checks or review comments to the agent. |

Each extension sends its prompts to the agent session that is selected in the Ghostex sidebar.

## Install

Requirements: Node 20 or later, `git`, `gh` (logged in), and `rg`.

```sh
npm run setup      # npm ci in each extension
npm run sideload   # sync shared code, build, install into Ghostex, and pin to the top bar
```

To change where an extension opens (top-bar popup, side-panel view, or modal), use Settings > Extensions.

## Layout

```text
shared/                  code used by more than one extension (bridge, agent delivery, notes, Monaco)
tooling/template/        build.mjs and sideload.mjs copied into each extension
tooling/sync-shared.mjs  copies shared/ to extensions/*/src/shared/ and the templates to each extension
extensions/<id>/         one self-contained extension, in the Ghostex catalog layout
```

Edit `shared/`, not `extensions/*/src/shared/`. `npm run build` runs the sync first.
Each extension folder is self-contained (own `package.json`, lockfile, and committed `dist/`), so it can be submitted to the Ghostex catalog as it is.

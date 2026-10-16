# Explorer

Browse and search project files, open them in Monaco, and send line notes to the active agent.

## Features

- File tree of the project: folders first, sorted by name, with git status colors on files and folders.
- Find files by name (fuzzy match) or by content (`rg`, with match case, whole word, and regex options).
- Edit mode: a Monaco editor. Save with Cmd+S. A dot shows unsaved changes.
- Changes mode: a diff of the file against `HEAD`, with unsaved edits included. The diff is editable.
- Line notes in Changes mode: click the `+` in the gutter, write a note, and send or queue all notes to the active agent.
- Header menu: Reveal in Finder, Open in Ghostex Code, and Copy path.
- The tree refreshes when the window gets focus and when the project changes.
- At 900px and wider, the list is a 300px column on the right and the editor fills the left. Below 900px, the editor replaces the list, and the header shows the Cmd+Ctrl+E hint to expand the panel.

## Permissions

- `exec`: runs `git`, `rg`, `cat`, `open -R`, and `pbcopy` in the project folder, and writes saved files.
- `cli`: sends prompts to the active agent session with `ghostex send-session-chat-message` and `ghostex queue-session-chat-prompt`, and opens files with `ghostex edit --goto`.

# Keyboard shortcuts

| Key                               | Action                                                                                                          |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `Enter`                           | Split at the caret into a new sibling below (at the end of an expanded bullet, adds a child at the top instead) |
| `Tab` / `Shift+Tab`               | Indent / outdent                                                                                                |
| `Cmd/Ctrl+Shift+↑` / `↓`          | Move the bullet among siblings; at the edge reparent into the parent's adjacent sibling                         |
| `Cmd/Ctrl+↑` / `↓`                | Collapse / expand                                                                                               |
| `Cmd/Ctrl+Enter` or `Cmd/Ctrl+D`  | Toggle complete                                                                                                 |
| `Cmd/Ctrl+.` / `Cmd/Ctrl+,`       | Zoom in / out                                                                                                   |
| `Backspace` on an empty bullet    | Delete it and focus the previous one                                                                            |
| `Arrow ↑` / `↓` at line edges     | Move between bullets (preserves the caret column)                                                               |
| `Cmd/Ctrl+Z` / `Cmd/Ctrl+Shift+Z` | Undo / redo                                                                                                     |
| `Shift+↑` / `↓`                   | Select whole nodes (then `Tab` indents the run, `Backspace` deletes it, …)                                      |
| `Cmd/Ctrl+K`                      | Open the command center                                                                                         |
| `Cmd/Ctrl+F`                      | Filter the current view (`?q=` — tags, operators, free text)                                                    |
| `q`                               | Quick-add capture (files to Today without leaving where you are)                                                |

The `/` menu on any bullet lists every command (to-do, paragraph, move,
mirror, formatting, …), and `Cmd/Ctrl+K` runs node + global actions from
anywhere.

## Workbench (columns and tabs)

Wide screens only. Every action except focusing a column by number is also
in `Cmd/Ctrl+K` (focus left/right is there).

| Key                                                     | Action                                                                 |
| ------------------------------------------------------- | ---------------------------------------------------------------------- |
| Mac `Ctrl+1`…`4`; Windows `Alt+1`…`4`                   | Focus column 1–4                                                       |
| `Ctrl+Alt+[` / `Ctrl+Alt+]` (Mac `Ctrl+Option+[` / `]`) | Focus the column on the left / right                                   |
| `Cmd/Ctrl+\`                                            | Split: open this view in a new column                                  |
| Mac `Ctrl+W`; others `Alt+W`                            | Close the active tab                                                   |
| `Alt+[` / `Alt+]` (Mac `Option+[` / `]`)                | Previous / next tab in the column                                      |
| `Ctrl+Alt+←` / `Ctrl+Alt+→` (Mac `Ctrl+Option+←` / `→`) | Move the selection (or the bullet) into the column on the left / right |

Chosen against the existing bindings above and the browsers' reserved keys
(`Cmd+1…9`, `Cmd+W`, `Cmd+T/N`, `Ctrl+Tab` cannot be overridden by a web
page). Linux Chrome keeps `Alt+1…8` for its own tabs, so on Linux use
`Ctrl+Alt+[` / `]` or `Cmd/Ctrl+K` to move between columns. `Option` chords on
a Mac type special characters, so the workbench matches the physical key and
cancels the character.

A move into another column lands right after the bullet that column last had
the caret in (or at the end of its view), and the caret stays where you were,
on the next bullet. One `Cmd/Ctrl+Z` puts the move back. `Ctrl+Option+arrows`
are also VoiceOver's keys while it runs, and some Windows graphics drivers
rotate the screen on `Ctrl+Alt+arrows`; the `/move` picker, which lists the
open tabs first, and `Cmd/Ctrl+K` do the same move.

Mouse: click a sidebar note to preview it (italic tab, replaced by the next
preview); double-click it, `Cmd/Ctrl+click` it, or edit in its tab to keep it
open. Double-click a tab to keep it, middle-click to close it. Drag a tab to
another column's tab strip to move it; drag a sidebar note onto a column to
open it there. Drag the bar between columns to resize them, double-click it to
make them equal.

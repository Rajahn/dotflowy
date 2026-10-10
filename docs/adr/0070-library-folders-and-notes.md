---
status: accepted
---

# Library: folders and notes over top-level nodes

The multi-column workbench (`docs/workbench/PLAN.md` 1.2, 2.5) gives the outline
a sidebar of folders and notes, the way Dynalist or a file tree does. The outline
data model stays as it is: a note is not a new kind of node, and a folder is not
a node at all.

## Decisions

- **A note is an ordinary top-level node** (`parentId = null`) and its subtree.
  The note's title IS that node's text, read live; the library stores no second
  copy, so renaming a note edits its root node (through the editor's text
  funnel, with undo).
- **A folder lives only in the library.** Folders nest, and only group notes; a
  note can't be "put inside" another note's outline -- that is moving a node,
  which is the outline's job.
- **The library is a kv side-collection** (`library`, added to
  `KV_COLLECTIONS`), in the saved-queries mould
  ([ADR 0048](./0048-saved-filter-queries.md)): one row per folder or note,
  `{ id, type, parentId, rank, title? (folder), rootNodeId? (note) }`. It rides
  the per-user Durable Object, syncs on focus, and is covered by the R2 backup
  with the rest of the kv table. No `Node` field, no migration, no client-side
  data migration. The kv write body is the generic, schema-decoded kv upsert.
- **Order is a fractional `rank`**: a move rewrites only the moved row, so two
  devices reordering different items never fight over a sibling list.
- **Unfiled is derived, not stored.** Every top-level node that no visible note
  row points at shows under a virtual "Unfiled" folder: seed content, outlines
  that predate the library, roots an agent created over MCP. Dragging one into a
  folder files it. A plugin's own node (the Daily container) has a fixed sidebar
  entry instead (plugin Seam S, `docs/plugins.md`) and is left out of Unfiled.
- **Hidden, not deleted.** A note row whose node is missing, or no longer
  top-level, is hidden; a second row for the same node loses to the first in
  tree order. Deleting a note deletes its node (an undoable outline edit) and
  leaves the row, so undo brings the note back to its place. Rows from a deleted
  folder, or caught in a folder cycle, show at the library root.
- **Library edits are side data, not undo steps**
  ([ADR 0064](./0064-session-local-undo-redo.md)). Only the node edits a library
  action makes (create, rename, delete a note) join the undo history.
- **First version limits:** only an empty folder can be deleted; no sharing,
  per-folder permissions, or cross-device layout.

## Consequences

- MCP and the CLI keep working on nodes; library tools (list, create folder,
  create note, move note) are additive.
- The library is reconciled on focus, not pushed live: a root an agent creates
  appears under Unfiled at once (node sync is live) and moves to its folder when
  the library refetches.

## Agents (added with the MCP library tools)

- **Agent notes go to an "Agent" folder** (`docs/mcp.md`): `create_note` files
  there unless told otherwise, reusing a top-level folder the person named
  "Agent" and otherwise creating one under a fixed id, so two racing agent
  calls make one folder.
- **No polling.** The library's existing refetch on window focus is the
  reconciliation; a person switching back to the app is exactly when an
  agent's filing needs to show. A push channel for kv rows would be a sync
  protocol change, out of scope for an additive feature.

---
status: accepted
---

# Dragging across columns, and copying subtrees

The workbench (`docs/workbench/PLAN.md` 1.4, 2.6, 2.7) shows several outlines
side by side; its point is moving material between them. The bullet drag of
[ADR 0010](./0010-field-edits-serialize-coalesce-ignore-echoes.md) now crosses
columns, and gains a copy mode.

## Decisions

- **Drop on content moves content; drop on chrome opens views.** Over another
  column's outline the drop is projected on that column's own rows, view state
  and virtual geometry (its `DragSurface`), with the same gap, depth and
  nest-resistance rules as an in-column drag. A drop on a tab strip's empty
  space opens the node in a new tab there and moves nothing; resting on another
  column's tab for half a second switches that column to it, and the drag goes
  on. The drag's own column never switches mid-drag (its editor, and the drag,
  would remount).
- **Sidebar targets.** A note takes the node as the last child of its root; a
  folder makes it a new top-level node filed in that folder.
- **Alt/Option copies.** The pill shows a Copy badge while Alt is held, and it
  can be pressed or released mid-drag. A copy is a deep copy in one atomic
  structural batch ([ADR 0009](./0009-atomic-structural-writes.md)): text,
  kind, task state, completion, collapse and `mirrorOf` are kept (a copied
  mirror is another mirror of the same source); the owner lock, the bookmark and
  provenance are dropped; node links in the text keep their targets. Ids are new
  and the sibling chains are rebuilt (`planSubtreeCopy`, unit-tested).
- **A selection travels whole.** A drag that starts on a selected row carries
  the selection's roots, in order, for a move or a copy.
- **One drop, one undo step.** Every drop -- whichever columns it touched, one
  node or many -- is a single history capture.
- **Refusals are visible, not silent.** A locked target parent, or a drop into
  one of the dragged nodes' own subtrees (another column may show it), shows the
  not-allowed cursor and drops nothing. Escape cancels any drag.
- The in-column, single-node move keeps its existing path (focus re-derivation
  through mirrors, the filtered-view "moved but hidden" toast); copies,
  selections and cross-column drops go through one `commitDrop`.

## Consequences

- Native HTML drag and drop stays for the workbench's own chrome (sidebar rows,
  tabs); the bullet drag stays a pointer drag. They don't interfere: each reads
  only its own payload.
- Mobile has no cross-column drag (one column there); moving between notes uses
  the "Move to…" picker.

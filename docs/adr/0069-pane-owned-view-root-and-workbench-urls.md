---
status: accepted
---

# The view root belongs to a workbench tab; the URL mirrors the active tab

Dotflowy is becoming a multi-column workbench (`docs/workbench/PLAN.md`): one
to four panes, each with tabs, each tab a zoom view with its own `?q=` filter
and back/forward stack. A route can describe one view; a workbench shows
several at once. So the zoom root moves out of the router and into the tab, and
the URL becomes a projection of the **active** tab.

This revises "`rootId` is route-owned" (AGENTS.md, `docs/architecture.md`),
the window-virtualization premise of
[ADR 0019](./0019-virtualized-outline-rendering.md), and the "return to the
editing location" decision of
[ADR 0064](./0064-session-local-undo-redo.md). Snapshot undo itself, and its
external-write rule, are unchanged.

## Decisions

- **The workbench store owns every view.** `src/workbench/store.ts` holds the
  panes, their tabs, and each tab's root, filter and history stacks; the rules
  that change them are pure functions in `src/workbench/model.ts`. Editors take
  `rootId` from their tab and key by `tab.id + rootId`, so a zoom still mounts a
  fresh editor (the view-transition and mount-only focus effects depend on it).
- **The root route renders the workbench** for `/` and `/$nodeId` and keeps it
  mounted across both; those routes render nothing. Moving between the two URLs
  never remounts a pane whose view did not change.
- **URL rules** (`src/workbench/url-sync.ts`, table-tested in `model.test.ts`):
  - The URL shows the active tab: `/` or `/$nodeId`, plus its `?q=`.
  - A zoom in the active tab pushes; a tab or pane switch, and a live filter
    edit, replace. The workbench marks its own writes so it never re-reads them.
  - Browser back/forward to `/$X`: if X is in the active tab's back (or, going
    forward, forward) stack, that tab steps there; else, if a tab already shows
    X, it is focused; else the active tab zooms to X.
  - The location the workbench mounts on is a deep link: a tab already showing
    the root is focused, else a new pinned tab opens in the active pane.
    `/today?focus=last` follows the same rule and carries the focus-last intent.
  - Any other navigation (`navigate({ to: "/$nodeId" })` from the switcher, a
    backlink, a plugin) zooms the active tab, as it always zoomed "the" editor.
    Existing call sites keep working unchanged.
- **One-shot zoom intents replace history state.** The zoom pivot (the morph
  target and focus landing) and focus-last used to ride `location.state` and the
  search params. They are now a per-tab intent, consumed by identity on the
  editor's mount, so a later remount of the same view never replays them.
- **View transitions run outside the router.** A zoom calls
  `document.startViewTransition` with the `zoom` type around a synchronous store
  update. Only the active pane zooms with a transition, so two panes showing one
  node never produce duplicate `view-transition-name`s (the browser would abandon
  the whole transition).
- **Scrolling.** On wide screens each pane root scrolls on its own; the
  workbench remembers each tab view's offset (top on a fresh zoom, restored on
  back/forward). Narrow screens (< 768px, the
  [ADR 0066](./0066-narrow-screen-menu-drawers.md) breakpoint) keep page
  scrolling and the router's window scroll restoration, because the keyboard
  viewport, caret drawers and address-bar collapse rely on it. ADR 0019's
  windowed list is unchanged in kind: it virtualizes over the pane root or the
  window, chosen per mount.
- **Undo returns to its tab.** A history entry records the pane and tab of the
  edit. Undo shows that tab again (zoomed to the entry's root) while it is open,
  else uses the active pane. One undo history per browser tab, as before.

## Consequences

- Event-time code reads view state for a pane: the plain getters
  (`getViewRootId()` and friends) answer for the active pane, which follows
  pointer and focus; code holding an element resolves its pane with `paneIdOf`.
- Header and subheader chrome read their pane's root (`usePaneRootId`) instead
  of route params.
- Tabs opened by deep links accumulate in the layout; the tab bar that lets a
  person see and close them arrives with the multi-column layout.

## Layout and tabs (added with the multi-column layout)

- **One to four columns**, each holding tabs; a column with one tab and no
  sibling column shows no tab strip, so the single-column default looks like
  the editor it replaced. A split copies the active view into a new column on
  the right; a column closes with its last tab, except the last column, which
  shows an empty state with recently opened notes.
- **Preview tabs** follow VS Code: a sidebar click opens a preview (italic)
  that the next preview in the same column replaces; a double-click on the note
  or the tab, a Cmd/Ctrl+click, a drop, or any write into it pins it. Zooming
  inside a preview does not pin it. A root already open in a column is focused
  rather than opened twice; different columns may show the same node.
- **Layout persistence** is per device and per account
  (`dotflowy:workbench-layout:v1:<userId>` in localStorage): columns, widths,
  tabs (root, filter, preview), the active column, and the sidebar. History
  stacks are not saved. Restored tabs whose node is gone are dropped once the
  outline has synced, and a tab closes when the node it shows is deleted.
- **Keyboard**: the workbench chords and how they were checked for conflicts
  are listed in `docs/keyboard.md`; every one is also a Cmd+K action.

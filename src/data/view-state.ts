import { useEffect } from "react";

import type { QueryFilter } from "./filter-query";
import type { Node } from "./tree";

import { getActivePaneId, paneIdOf } from "./panes";

/**
 * The editor's ephemeral *view* state (the zoom root and the composed
 * visibility prune), mirrored into a per-pane module store so the stable
 * command/drag/zoom closures can read the current value at EVENT time without
 * depending on this render -- exactly as {@link getTreeIndex} does for the tree
 * itself (tree-store.ts). Keeping these out of the closures' deps is what lets
 * `commands` keep its identity across renders, a prop on every memoized
 * OutlineRow (see docs/adr/0004-localized-rendering-via-the-tree-store.md).
 *
 * Two read paths for the same value:
 *  - **Render reads** use the React value directly (the `rootId` prop, the
 *    `isHidden` memo) so they stay reactive. Never read these getters in render.
 *  - **Event-time reads** (drag, command handlers, zoom, hotkeys -- all fire on
 *    pointer/key/click, after commit) go through {@link getViewRootId} /
 *    {@link getViewIsHidden}.
 *
 * One entry per workbench pane (docs/workbench/PLAN.md 2.2). The plain
 * getters read the ACTIVE pane ({@link getActivePaneId}): every event-time
 * caller fires from a pane the workbench host has just made active (capture-
 * phase pointerdown/focusin), so a caller that never heard of panes still
 * reads the right column. Code that holds an element or knows its pane reads
 * the `...For(paneId)` variants instead. An entry outlives its editor's unmount
 * (a route change to /settings keeps the last view), exactly as the old
 * singleton did; the workbench drops it with {@link forgetPaneView} when the
 * pane itself closes. Writes happen in an effect (NOT during render), so
 * nothing here trips the React Compiler's ref-during-render bailout.
 */

interface PaneView {
  rootId: string | null;
  isHidden: (node: Node) => boolean;
  filter: QueryFilter | null;
}

const NEVER_HIDDEN = () => false;
const views = new Map<string, PaneView>();

function viewFor(paneId: string): PaneView {
  let view = views.get(paneId);
  if (!view) {
    view = { rootId: null, isHidden: NEVER_HIDDEN, filter: null };
    views.set(paneId, view);
  }
  return view;
}

/** The zoom root of `paneId`, read live OUTSIDE render. */
export function getViewRootIdFor(paneId: string): string | null {
  return views.get(paneId)?.rootId ?? null;
}

/** The composed visibility prune of `paneId`, read live OUTSIDE render. */
export function getViewIsHiddenFor(paneId: string): (node: Node) => boolean {
  return views.get(paneId)?.isHidden ?? NEVER_HIDDEN;
}

/** The `?q=` filter of `paneId`, read live OUTSIDE render. */
export function getViewFilterFor(paneId: string): QueryFilter | null {
  return views.get(paneId)?.filter ?? null;
}

/** The zoom root of the pane owning `el` (the active pane when `el` sits in
 *  no pane). The zoomed title has no row id, so Seam-B handlers resolve "the
 *  node this element belongs to" through here. */
export function getViewRootIdForElement(el: Element): string | null {
  return getViewRootIdFor(paneIdOf(el) ?? getActivePaneId());
}

/** Write part of `paneId`'s view mirror. The sync hooks below call this from
 *  an effect; exported for tests. */
export function setPaneView(paneId: string, patch: Partial<PaneView>): void {
  Object.assign(viewFor(paneId), patch);
}

/** Drop a closed pane's entry. */
export function forgetPaneView(paneId: string): void {
  views.delete(paneId);
}

/** The current zoom root, read live OUTSIDE render (event handlers, command
 *  closures, drag, hotkeys). Render reads must use the `rootId` prop instead so
 *  they stay reactive. */
export function getViewRootId(): string | null {
  return getViewRootIdFor(getActivePaneId());
}

/** The current composed visibility prune (Seam-G; hide-completed today), read
 *  live OUTSIDE render. Render reads must use the `isHidden` memo instead. */
export function getViewIsHidden(): (node: Node) => boolean {
  return getViewIsHiddenFor(getActivePaneId());
}

/** The active `?q=` query filter's pruned set (ADR 0047), read live OUTSIDE render. Null
 *  when no filter is on. Event-time readers: the caret/focus walks (arrow nav,
 *  delete-focus, selection caret exits -- they must hand back RENDERED rows,
 *  ADR 0047 amendment) and the markdown paste, which must know whether what it
 *  just inserted actually landed on screen (ADR 0044: a paste never mutates
 *  view state, so it discloses instead). */
export function getViewFilter(): QueryFilter | null {
  return getViewFilterFor(getActivePaneId());
}

/**
 * Sync `paneId`'s live view mirror from its editor's render values. Call once
 * in OutlineEditor. The writes run in an effect -- after commit, so the mirror
 * always reflects the committed render at event time (identical to the old
 * render-written refs, since nothing reads these during render/layout) and
 * nothing here writes a ref during render.
 */
export function useSyncViewState(
  paneId: string,
  nextRootId: string | null,
  nextIsHidden: (node: Node) => boolean,
): void {
  useEffect(() => {
    setPaneView(paneId, { rootId: nextRootId, isHidden: nextIsHidden });
  }, [paneId, nextRootId, nextIsHidden]);
}

/** The filter is derived further down the editor than `useSyncViewState`'s
 *  inputs (it needs `isHidden` first), so it mirrors on its own. */
export function useSyncViewFilter(
  paneId: string,
  nextFilter: QueryFilter | null,
): void {
  useEffect(() => {
    setPaneView(paneId, { filter: nextFilter });
  }, [paneId, nextFilter]);
}

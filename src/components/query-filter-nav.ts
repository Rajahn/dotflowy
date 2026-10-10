import { tokenizeQuery } from "../data/filter-query";
import { getActivePaneId } from "../data/panes";
import { getActivePaneTab, setPaneFilter } from "../workbench/store";

// The `?q=` filter is CORE chrome now (the query grammar, ADR 0047 §6). This
// module holds the filter writers + the summon-opener registry so surfaces
// OUTSIDE the React tree (a tags-plugin chip click, the Cmd+F hotkey, the Cmd+K
// "Filter this view" action) can drive the filter without a hook. The React
// half (the hook + the bar/input UI) lives in `query-filter.tsx`, which
// registers on mount.
//
// The filter belongs to a workbench tab (docs/workbench/PLAN.md 1.3): each
// pane's active tab has its own `?q=`, and the URL mirrors the active pane's.
// Writers act on the ACTIVE pane -- the filter input, a chip click and Cmd+K
// all fire from (or for) the pane that has focus.

/** Write a raw `?q=` string (empty = drop the param) into the active pane's
 *  tab. `replace` avoids spamming history on live-as-you-type edits. */
export function writeQuery(q: string, opts?: { replace?: boolean }) {
  setPaneFilter(getActivePaneId(), q, { replace: opts?.replace ?? false });
}

/** Write the query from a token list (the tag-chip AND-in dedup path). */
export function writeQueryTokens(tokens: string[]) {
  writeQuery(tokens.join(" "));
}

/** AND a term (a `#tag`, `is:todo`, ...) into the active filter, deduped against
 *  the surface tokens already in `?q=`. Used by the tags plugin's chip click
 *  (Seam B) -- the plugin only knows "add this term", the grammar is core. */
export function addTermToFilter(term: string) {
  const current = tokenizeQuery(getActivePaneTab()?.q || undefined);
  if (current.includes(term)) return;
  writeQueryTokens([...current, term]);
}

// --- The summon-input opener registry ---------------------------------------

interface FilterInputController {
  open: () => void;
  close: () => void;
  isOpen: () => boolean;
}

const controllers = new Map<string, FilterInputController>();

/** Registered by each pane's `QueryFilterBar` so Cmd+F / the header magnifier /
 *  the Cmd+K action can summon (or dismiss) that pane's filter input. Returns
 *  the unregister, which only clears the entry if it is still this one. */
export function setFilterInputController(
  paneId: string,
  next: FilterInputController,
): () => void {
  controllers.set(paneId, next);
  return () => {
    if (controllers.get(paneId) === next) controllers.delete(paneId);
  };
}

/** Summon the active pane's filter input (focused, prefilled if a filter is
 *  active). */
export function openFilterInput(paneId: string = getActivePaneId()) {
  controllers.get(paneId)?.open();
}

/** Header-magnifier toggle: open when idle, dismiss (clear + collapse) when
 *  the filter row is showing. Cmd+F / Cmd+K keep the open-only path. */
export function toggleFilterInput(paneId: string = getActivePaneId()) {
  const controller = controllers.get(paneId);
  if (controller?.isOpen()) controller.close();
  else controller?.open();
}

// --- Reactive open-signal (ADR 0050) ----------------------------------------
// `QueryFilterBar` owns whether the input is showing (`summoned || active`) in
// local state, but `FilterButton` lives in the header and must LIGHT while the
// input is open -- even before a query is typed. The `isOpen` probe above is a
// non-reactive read; this is its subscribable twin, mirroring the
// `spotlight-mode` / `show-completed` store pattern. Each pane's
// `QueryFilterBar` publishes `showInput` here; its `FilterButton` subscribes
// via `useSyncExternalStore`.

const filterOpen = new Set<string>();
const openListeners = new Set<() => void>();

/** Publish a pane's input open state (called by `QueryFilterBar` on change). */
export function setFilterOpen(paneId: string, next: boolean) {
  if (next === filterOpen.has(paneId)) return;
  if (next) filterOpen.add(paneId);
  else filterOpen.delete(paneId);
  for (const l of openListeners) l();
}

/** Subscribe to open-state changes (for `useSyncExternalStore`). */
export function subscribeFilterOpen(cb: () => void) {
  openListeners.add(cb);
  return () => {
    openListeners.delete(cb);
  };
}

/** Snapshot of a pane's input open state (for `useSyncExternalStore`). */
export function getFilterOpen(paneId: string) {
  return filterOpen.has(paneId);
}

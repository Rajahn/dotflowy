import { useSyncExternalStore } from "react";

import { DEFAULT_PANE_ID } from "../data/panes";

/**
 * The workbench layout: the panes (columns) on screen, left to right
 * (docs/workbench/PLAN.md 2.2). A module store read with
 * `useSyncExternalStore`, like the tree store: the layout is app chrome, not
 * outline data, so it never touches a collection.
 *
 * Today the layout is fixed at the one pane every route renders into; tabs,
 * splitting and persistence grow on this shape in later phases. The active
 * pane id lives in `data/panes.ts`, where the event-time readers can reach it
 * without importing React chrome.
 */

export interface WorkbenchPane {
  id: string;
}

export interface WorkbenchState {
  panes: readonly WorkbenchPane[];
}

let state: WorkbenchState = { panes: [{ id: DEFAULT_PANE_ID }] };
const listeners = new Set<() => void>();

export function getWorkbenchState(): WorkbenchState {
  return state;
}

export function subscribeWorkbench(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Replace the layout. Exported for later phases and tests. */
export function setWorkbenchState(next: WorkbenchState): void {
  if (next === state) return;
  state = next;
  for (const l of listeners) l();
}

export function useWorkbenchState(): WorkbenchState {
  return useSyncExternalStore(
    subscribeWorkbench,
    getWorkbenchState,
    getWorkbenchState,
  );
}

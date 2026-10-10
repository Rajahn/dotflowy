/**
 * The per-pane half of the workbench's window hotkeys (docs/workbench/PLAN.md
 * 2.2). Undo/redo and zoom-out used to be registered by every editor mount, so
 * N columns would mean one keypress firing N times. Now the workbench host
 * registers each chord ONCE and dispatches to the active pane's actions, which
 * that pane's editor publishes here on mount.
 */

import { getActivePaneId } from "../data/panes";

export interface PaneActions {
  /** Cmd/Ctrl+Z: restore the previous history entry, landing focus in this
   *  pane's editor. */
  undo: () => void;
  /** Cmd/Ctrl+Shift+Z. */
  redo: () => void;
  /** Cmd/Ctrl+,: zoom this pane out one level. */
  zoomOut: () => void;
}

const actions = new Map<string, PaneActions>();

/** Publish `paneId`'s actions. Returns the unpublish, which only clears the
 *  entry if it is still this one (a remounting editor may have replaced it). */
export function registerPaneActions(
  paneId: string,
  next: PaneActions,
): () => void {
  actions.set(paneId, next);
  return () => {
    if (actions.get(paneId) === next) actions.delete(paneId);
  };
}

export function getPaneActions(paneId: string): PaneActions | null {
  return actions.get(paneId) ?? null;
}

/** Run one window chord's action on the ACTIVE pane only. The host's hotkeys
 *  call this; a pane with no mounted editor is a no-op. */
export function dispatchPaneAction(kind: keyof PaneActions): void {
  getPaneActions(getActivePaneId())?.[kind]();
}

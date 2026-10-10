import { useSyncExternalStore } from "react";

import { getActivePaneId, subscribeActivePane } from "../data/panes";
import { usePaneId } from "./pane-context";
import { getActivePaneTab, subscribeWorkbench, usePaneTab } from "./store";

/** The zoom root of the pane this component renders in (null at the top).
 *  Header and subheader chrome read it instead of the route params: each pane
 *  has its own view, and the URL only mirrors the active one. */
export function usePaneRootId(): string | null {
  return usePaneTab(usePaneId())?.rootId ?? null;
}

function subscribeActiveView(cb: () => void): () => void {
  const offPane = subscribeActivePane(cb);
  const offStore = subscribeWorkbench(cb);
  return () => {
    offPane();
    offStore();
  };
}

const activeRootId = () => getActivePaneTab()?.rootId ?? null;

/** The ACTIVE pane's zoom root, for chrome outside every pane (the Cmd+K
 *  command center). */
export function useActivePaneRootId(): string | null {
  return useSyncExternalStore(subscribeActiveView, activeRootId, () => null);
}

/** The active pane's id, reactively. */
export function useActivePaneId(): string {
  return useSyncExternalStore(
    subscribeActivePane,
    getActivePaneId,
    getActivePaneId,
  );
}

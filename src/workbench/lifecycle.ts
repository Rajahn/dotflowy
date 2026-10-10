import { useEffect, useLayoutEffect } from "react";

import {
  getActivePaneId,
  setActivePaneId,
  subscribeActivePane,
} from "../data/panes";
import { getTreeIndex, subscribeTree, useSyncReady } from "../data/tree-store";
import { useSession } from "../lib/auth-client";
import { fromSaved, loadLayout, saveLayout, toSaved } from "./persist";
import {
  closeTabsShowing,
  getSidebarState,
  getWorkbenchState,
  newTabId,
  setSidebarState,
  setWorkbenchState,
  subscribeSidebar,
  subscribeWorkbench,
} from "./store";

/** Restore once per page: the store outlives the workbench's remounts. */
let restoredFor: string | null = null;
/** Tabs that came back from storage, checked once nodes are synced. */
let restoredTabIds = new Set<string>();

const SAVE_DELAY_MS = 300;

/**
 * The workbench's life outside any single render (docs/workbench/PLAN.md 1.6,
 * 1.8):
 *  - restore this account's saved layout before the URL sync reads it (a
 *    layout effect, so it lands before the sync's passive effect and before
 *    paint), and save every change shortly after it happens;
 *  - once the outline has synced, drop restored tabs whose node is gone;
 *  - close a tab when the node it shows is deleted (here, in another tab, or
 *    on another device). A root never seen to exist -- a deep link to a
 *    missing node -- keeps its tab and the "doesn't exist" notice.
 */
export function useWorkbenchLifecycle(): void {
  const userId = useSession().data?.user.id ?? null;
  const syncReady = useSyncReady();

  useLayoutEffect(() => {
    if (!userId || restoredFor === userId) return;
    restoredFor = userId;
    const saved = loadLayout(userId);
    if (!saved) return;
    const restored = fromSaved(saved, newTabId);
    if (!restored) return;
    restoredTabIds = new Set(
      restored.state.panes.flatMap((p) => p.tabs.map((t) => t.id)),
    );
    setSidebarState(saved.sidebar);
    setActivePaneId(restored.activePaneId);
    setWorkbenchState(restored.state);
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const save = () => {
      timer = null;
      saveLayout(
        userId,
        toSaved(getWorkbenchState(), getActivePaneId(), getSidebarState()),
      );
    };
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(save, SAVE_DELAY_MS);
    };
    // A pending save is written, not dropped, when the page goes away or the
    // workbench unmounts (another route, an error reset).
    const flush = () => {
      if (!timer) return;
      clearTimeout(timer);
      save();
    };
    const offs = [
      subscribeWorkbench(schedule),
      subscribeActivePane(schedule),
      subscribeSidebar(schedule),
    ];
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
      for (const off of offs) off();
    };
  }, [userId]);

  useEffect(() => {
    if (!syncReady || restoredTabIds.size === 0) return;
    const index = getTreeIndex();
    const restored = restoredTabIds;
    restoredTabIds = new Set();
    const tabsGone = new Set<string>();
    for (const pane of getWorkbenchState().panes)
      for (const tab of pane.tabs)
        if (
          restored.has(tab.id) &&
          tab.rootId !== null &&
          !index.byId.has(tab.rootId)
        )
          tabsGone.add(tab.rootId);
    if (tabsGone.size) closeTabsShowing((rootId) => tabsGone.has(rootId));
  }, [syncReady]);

  useEffect(() => {
    const seen = new Set<string>();
    const check = () => {
      const index = getTreeIndex();
      if (index.byId.size === 0) return;
      const gone = new Set<string>();
      for (const pane of getWorkbenchState().panes)
        for (const tab of pane.tabs) {
          if (tab.rootId === null) continue;
          if (index.byId.has(tab.rootId)) seen.add(tab.rootId);
          else if (seen.has(tab.rootId)) gone.add(tab.rootId);
        }
      if (gone.size === 0) return;
      for (const id of gone) seen.delete(id);
      closeTabsShowing((rootId) => gone.has(rootId));
    };
    check();
    const offTree = subscribeTree(check);
    const offStore = subscribeWorkbench(check);
    return () => {
      offTree();
      offStore();
    };
  }, []);
}

import type { HistoryLocation } from "@tanstack/history";

import { useRouter } from "@tanstack/react-router";
import { useEffect } from "react";

import { getActivePaneId } from "../data/panes";
import {
  activeTab,
  urlShowsView,
  type OutlineSearch,
  type TabView,
} from "./model";
import {
  followUrl,
  getWorkbenchState,
  subscribeWorkbench,
  takeUrlWriteMode,
} from "./store";

// Mark the history entries the workbench writes itself, so its own history
// subscriber can tell them from every other navigation.
declare module "@tanstack/history" {
  interface HistoryState {
    workbenchWrite?: number;
  }
}

/** The view an outline URL names, or null for any other route. */
interface OutlineUrl {
  view: TabView;
  focusLast: boolean;
  nodeId: string | null;
  search: OutlineSearch;
}

/**
 * Keep the URL and the workbench in step (docs/workbench/PLAN.md 1.7). The
 * workbench owns every tab's view; the URL is a projection of the ACTIVE tab
 * (`/` or `/$nodeId`, plus `?q=`):
 *
 *  - the workbench writes the URL after its own changes: a zoom pushes, a tab
 *    switch or filter keystroke replaces;
 *  - a browser back/forward resolves against the active tab's history, then
 *    the open tabs, then zooms the active tab;
 *  - the location the workbench mounts on is a deep link (an open tab wins,
 *    else a new pinned tab);
 *  - any other navigation (`navigate({ to: "/$nodeId" })` from the switcher,
 *    a backlink, a plugin) zooms the active tab, as it always zoomed "the"
 *    editor.
 */
export function useWorkbenchUrlSync(): void {
  const router = useRouter();
  useEffect(() => {
    let writeToken = 0;

    const parse = (location: HistoryLocation): OutlineUrl | null => {
      const [, params, found] = router.getMatchedRoutes(location.pathname);
      if (found?.id !== "/" && found?.id !== "/$nodeId") return null;
      const raw = new URLSearchParams(location.search);
      const search: OutlineSearch = {};
      const q = raw.get("q")?.trim();
      if (q) search.q = q;
      if (raw.get("focus") === "last") search.focus = "last";
      const nodeId = found.id === "/$nodeId" ? (params.nodeId ?? null) : null;
      return {
        view: { rootId: nodeId, q: search.q ?? "" },
        focusLast: search.focus === "last",
        nodeId,
        search,
      };
    };

    // Project the active tab onto the URL when they disagree.
    const write = () => {
      const tab = activeTab(getWorkbenchState(), getActivePaneId());
      const current = parse(router.history.location);
      const mode = takeUrlWriteMode();
      if (!tab || !current) return;
      if (urlShowsView(current.nodeId, current.search, tab)) return;
      writeToken += 1;
      const common = {
        search: tab.q ? { q: tab.q } : {},
        replace: mode === "replace",
        state: { workbenchWrite: writeToken },
      };
      if (tab.rootId === null) void router.navigate({ to: "/", ...common });
      else
        void router.navigate({
          to: "/$nodeId",
          params: { nodeId: tab.rootId },
          ...common,
        });
    };

    // The location the workbench mounts on is a deep link.
    const entered = parse(router.history.location);
    if (entered) followUrl("enter", entered.view, entered.focusLast);

    const unsubscribeHistory = router.history.subscribe(
      ({ location, action }) => {
        const own =
          (action.type === "PUSH" || action.type === "REPLACE") &&
          location.state.workbenchWrite === writeToken &&
          writeToken > 0;
        if (own) return;
        const next = parse(location);
        if (!next) return;
        const change =
          action.type === "BACK"
            ? "back"
            : action.type === "FORWARD"
              ? "forward"
              : action.type === "GO"
                ? "pop"
                : action.type === "PUSH"
                  ? "push"
                  : "replace";
        followUrl(change, next.view, next.focusLast);
      },
    );
    const unsubscribeStore = subscribeWorkbench(write);
    write();
    return () => {
      unsubscribeHistory();
      unsubscribeStore();
    };
  }, [router]);
}

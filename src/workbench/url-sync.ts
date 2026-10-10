import type { HistoryLocation } from "@tanstack/history";

import { defaultParseSearch, useRouter } from "@tanstack/react-router";
import { useLayoutEffect } from "react";

import { getActivePaneId, subscribeActivePane } from "../data/panes";
import { validateOutlineSearch } from "../data/tags";
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
  // A layout effect, so the location the page opened on is resolved before
  // the first paint: no editor mounts for a view the URL doesn't name.
  useLayoutEffect(() => {
    let writeToken = 0;

    const parse = (location: HistoryLocation): OutlineUrl | null => {
      const [, params, found] = router.getMatchedRoutes(location.pathname);
      if (found?.id !== "/" && found?.id !== "/$nodeId") return null;
      // The router's own parser: it writes values that look like JSON (a
      // quoted phrase, a number) JSON-encoded, and reads them back the same.
      const search: OutlineSearch = validateOutlineSearch(
        (router.options.parseSearch ?? defaultParseSearch)(location.search),
      );
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
    // Focusing another pane changes which tab the URL shows; it replaces.
    const unsubscribePane = subscribeActivePane(write);
    write();
    return () => {
      unsubscribeHistory();
      unsubscribeStore();
      unsubscribePane();
    };
  }, [router]);
}

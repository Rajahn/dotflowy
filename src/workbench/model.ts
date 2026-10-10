/**
 * The workbench layout as plain data, and every rule that changes it
 * (docs/workbench/PLAN.md 1.3, 1.7, 2.4). Pure: no React, no DOM, no router --
 * `store.ts` holds the live value and `url-sync.ts` talks to the router, both
 * through the functions here, so the rules are table-tested in `bun test`.
 *
 * A pane (column) holds tabs; a tab is one zoom view: its root (null = the
 * whole outline), its own `?q=` filter, and its own back/forward stacks.
 */

/** What a tab shows: the URL projects the active tab's view. */
export interface TabView {
  rootId: string | null;
  q: string;
}

export interface WorkbenchTab extends TabView {
  id: string;
  /** A preview tab (italic title) is replaced by the next preview open in the
   *  same pane; any write, or a double-click, pins it (PLAN 1.3). */
  preview: boolean;
  /** Views this tab zoomed away from, oldest first. */
  back: TabView[];
  /** Views a back step left, nearest first. */
  forward: TabView[];
}

export interface WorkbenchPane {
  id: string;
  tabs: WorkbenchTab[];
  /** Null only while the pane has no tabs (the last pane's empty state). */
  activeTabId: string | null;
  /** Relative width (a flex-grow ratio); panes start equal at 1. */
  width: number;
}

/** At most four columns (PLAN 1.3). */
export const MAX_PANES = 4;

export interface WorkbenchState {
  panes: WorkbenchPane[];
}

/** Ids for new tabs/panes, injected so tests are deterministic. */
export type MakeId = () => string;

export function makeTab(
  id: string,
  view: TabView,
  preview = false,
): WorkbenchTab {
  return { id, rootId: view.rootId, q: view.q, preview, back: [], forward: [] };
}

/** One pane showing the whole outline (PLAN 1.8's fallback layout). */
export function defaultLayout(paneId: string, tabId: string): WorkbenchState {
  return {
    panes: [
      {
        id: paneId,
        tabs: [makeTab(tabId, { rootId: null, q: "" })],
        activeTabId: tabId,
        width: 1,
      },
    ],
  };
}

export function findPane(
  state: WorkbenchState,
  paneId: string,
): WorkbenchPane | undefined {
  return state.panes.find((p) => p.id === paneId);
}

/** The pane's active tab, or undefined while it has none (empty state). */
export function activeTabOf(pane: WorkbenchPane): WorkbenchTab | undefined {
  return pane.tabs.find((t) => t.id === pane.activeTabId) ?? pane.tabs[0];
}

/** The active tab of `paneId`, or undefined when the pane is gone. */
export function activeTab(
  state: WorkbenchState,
  paneId: string,
): WorkbenchTab | undefined {
  const pane = findPane(state, paneId);
  return pane ? activeTabOf(pane) : undefined;
}

/**
 * Whether the layout is still the untouched default: one pane, one tab, at the
 * top, with no history. A page that opens on a deep link shows it in that tab
 * instead of opening a second one beside an empty "Whole outline".
 */
export function isPristine(state: WorkbenchState): boolean {
  const only = state.panes.length === 1 ? state.panes[0] : undefined;
  const tab = only?.tabs.length === 1 ? only.tabs[0] : undefined;
  return (
    tab !== undefined &&
    tab.rootId === null &&
    tab.back.length === 0 &&
    tab.forward.length === 0
  );
}

function sameView(a: TabView, b: TabView): boolean {
  return a.rootId === b.rootId && a.q === b.q;
}

/** Replace one tab, by id, wherever it lives. */
export function updateTab(
  state: WorkbenchState,
  tabId: string,
  update: (tab: WorkbenchTab) => WorkbenchTab,
): WorkbenchState {
  let changed = false;
  const panes = state.panes.map((pane) => {
    const i = pane.tabs.findIndex((t) => t.id === tabId);
    if (i < 0) return pane;
    const next = update(pane.tabs[i]!);
    if (next === pane.tabs[i]) return pane;
    changed = true;
    const tabs = pane.tabs.slice();
    tabs[i] = next;
    return { ...pane, tabs };
  });
  return changed ? { panes } : state;
}

/** Zoom a tab to `view`: the current view goes on the back stack and the
 *  forward stack is dropped, like a browser navigation. A no-op when the view
 *  is unchanged. Zooming never pins a preview tab (PLAN 1.3). */
export function zoomTab(tab: WorkbenchTab, view: TabView): WorkbenchTab {
  if (sameView(tab, view)) return tab;
  return {
    ...tab,
    rootId: view.rootId,
    q: view.q,
    back: [...tab.back, { rootId: tab.rootId, q: tab.q }],
    forward: [],
  };
}

/** Change a tab's view in place, with no history entry (a filter edit, a
 *  replace navigation). */
export function setTabView(tab: WorkbenchTab, view: TabView): WorkbenchTab {
  if (sameView(tab, view)) return tab;
  return { ...tab, rootId: view.rootId, q: view.q };
}

/** Step back to the most recent back entry whose root is `rootId` (the
 *  nearest one when null is passed as `undefined`). Undefined when there is no
 *  such entry. Every entry stepped over moves to the forward stack. */
export function tabBack(
  tab: WorkbenchTab,
  rootId?: string | null,
): WorkbenchTab | undefined {
  let i = tab.back.length - 1;
  if (rootId !== undefined) {
    while (i >= 0 && tab.back[i]!.rootId !== rootId) i--;
  }
  if (i < 0) return undefined;
  const target = tab.back[i]!;
  const stepped = [...tab.back.slice(i + 1), { rootId: tab.rootId, q: tab.q }];
  return {
    ...tab,
    rootId: target.rootId,
    q: target.q,
    back: tab.back.slice(0, i),
    // Chronological order after the target is already nearest-first.
    forward: [...stepped, ...tab.forward],
  };
}

/** The mirror of {@link tabBack}. */
export function tabForward(
  tab: WorkbenchTab,
  rootId?: string | null,
): WorkbenchTab | undefined {
  let i = 0;
  if (rootId !== undefined) {
    while (i < tab.forward.length && tab.forward[i]!.rootId !== rootId) i++;
  }
  if (i >= tab.forward.length) return undefined;
  const target = tab.forward[i]!;
  const stepped = [
    { rootId: tab.rootId, q: tab.q },
    ...tab.forward.slice(0, i),
  ];
  return {
    ...tab,
    rootId: target.rootId,
    q: target.q,
    back: [...tab.back, ...stepped],
    forward: tab.forward.slice(i + 1),
  };
}

/** The first tab showing `rootId`: the active pane's tabs first (its active
 *  tab before the rest), then the other panes left to right. */
export function findTabShowing(
  state: WorkbenchState,
  activePaneId: string,
  rootId: string | null,
): { paneId: string; tabId: string } | undefined {
  const ordered = [
    ...state.panes.filter((p) => p.id === activePaneId),
    ...state.panes.filter((p) => p.id !== activePaneId),
  ];
  for (const pane of ordered) {
    const active = activeTabOf(pane);
    const tabs = [
      ...(active ? [active] : []),
      ...pane.tabs.filter((t) => t !== active),
    ];
    const tab = tabs.find((t) => t.rootId === rootId);
    if (tab) return { paneId: pane.id, tabId: tab.id };
  }
  return undefined;
}

// --- URL rules (PLAN 1.7) ---------------------------------------------------

/**
 * What the workbench does when the URL changes under it. `target` is the view
 * the new URL names.
 *  - `back` / `forward`: the active tab steps through its own history.
 *  - `focus`: an existing tab already shows the root; make it active.
 *  - `zoom`: the active tab zooms to the root (a history entry).
 *  - `replace`: the active tab shows the view with no history entry.
 *  - `open`: a new pinned tab in the active pane.
 */
export type UrlResolution =
  | { kind: "back" | "forward"; paneId: string; tabId: string }
  | { kind: "focus"; paneId: string; tabId: string }
  | { kind: "zoom" | "replace"; paneId: string; tabId: string }
  | { kind: "open"; paneId: string };

/** How the URL changed: a browser back/forward/go (`pop`), a deep link the
 *  page or workbench opened on (`enter`), or another part of the app pushing
 *  or replacing the URL (`push` / `replace`). */
export type UrlChange =
  | "back"
  | "forward"
  | "pop"
  | "enter"
  | "push"
  | "replace";

export function resolveUrlChange(
  state: WorkbenchState,
  activePaneId: string,
  target: TabView,
  change: UrlChange,
): UrlResolution | undefined {
  const pane = findPane(state, activePaneId) ?? state.panes[0];
  if (!pane) return undefined;
  const tab = activeTabOf(pane);
  // An empty pane has nothing to step or zoom: the URL opens a tab there.
  if (!tab) return { kind: "open", paneId: pane.id };
  if (change === "push" || change === "replace") {
    return {
      kind: change === "push" ? "zoom" : "replace",
      paneId: pane.id,
      tabId: tab.id,
    };
  }
  if (change === "back" || change === "forward" || change === "pop") {
    // 1. The active tab's own history: back first, forward for a forward pop.
    if (
      change !== "forward" &&
      tab.back.some((v) => v.rootId === target.rootId)
    )
      return { kind: "back", paneId: pane.id, tabId: tab.id };
    if (
      change !== "back" &&
      tab.forward.some((v) => v.rootId === target.rootId)
    )
      return { kind: "forward", paneId: pane.id, tabId: tab.id };
    // 2. Already open somewhere: focus that tab.
    const open = findTabShowing(state, pane.id, target.rootId);
    if (open) return { kind: "focus", ...open };
    // 3. Otherwise the active tab zooms there.
    return { kind: "zoom", paneId: pane.id, tabId: tab.id };
  }
  // The bare start URL (`/`, the home-screen launch) names no view: the
  // restored layout keeps its own active tab.
  if (target.rootId === null && !target.q) return undefined;
  // A deep link: an existing tab wins, else a new pinned tab -- except into
  // the untouched default layout, whose lone tab simply shows it.
  const open = findTabShowing(state, pane.id, target.rootId);
  if (open) return { kind: "focus", ...open };
  if (isPristine(state))
    return { kind: "replace", paneId: pane.id, tabId: tab.id };
  return { kind: "open", paneId: pane.id };
}

/** The state after a URL resolution, and the pane/tab now active there. */
export interface UrlApplied {
  state: WorkbenchState;
  paneId: string;
  tabId: string;
}

/**
 * Apply a resolution. `target` supplies the root and the `?q=` filter (the URL
 * is the source of truth for the filter of whichever tab ends up active).
 * Returns the next state and the tab that is now active in that pane.
 */
export function applyUrlResolution(
  state: WorkbenchState,
  resolution: UrlResolution,
  target: TabView,
  makeId: MakeId,
): UrlApplied {
  if (resolution.kind === "open") {
    const tab = makeTab(makeId(), target);
    const panes = state.panes.map((p) =>
      p.id === resolution.paneId
        ? { ...p, tabs: [...p.tabs, tab], activeTabId: tab.id }
        : p,
    );
    return { state: { panes }, paneId: resolution.paneId, tabId: tab.id };
  }
  const { paneId, tabId } = resolution;
  let next = updateTab(state, tabId, (tab) => {
    switch (resolution.kind) {
      case "back":
        return withQ(tabBack(tab, target.rootId) ?? tab, target.q);
      case "forward":
        return withQ(tabForward(tab, target.rootId) ?? tab, target.q);
      case "focus":
        return withQ(tab, target.q);
      case "zoom":
        return zoomTab(tab, target);
      case "replace":
        return setTabView(tab, target);
    }
  });
  next = focusTab(next, paneId, tabId);
  return { state: next, paneId, tabId };
}

function withQ(tab: WorkbenchTab, q: string): WorkbenchTab {
  return tab.q === q ? tab : { ...tab, q };
}

/** Make `tabId` the active tab of `paneId`. */
export function focusTab(
  state: WorkbenchState,
  paneId: string,
  tabId: string,
): WorkbenchState {
  const pane = findPane(state, paneId);
  if (!pane || pane.activeTabId === tabId) return state;
  if (!pane.tabs.some((t) => t.id === tabId)) return state;
  return {
    panes: state.panes.map((p) =>
      p.id === paneId ? { ...p, activeTabId: tabId } : p,
    ),
  };
}

// --- Tabs and panes (PLAN 1.3) ---------------------------------------------

/**
 * Open `view` in `paneId`. A tab there already showing the root is focused
 * (and pinned when `preview` is false). Otherwise a preview open replaces the
 * pane's existing preview tab, or adds one; a pinned open adds a tab after the
 * active one. Returns the tab now active.
 */
export function openTab(
  state: WorkbenchState,
  paneId: string,
  view: TabView,
  opts: { preview: boolean },
  makeId: MakeId,
): { state: WorkbenchState; tabId: string } | undefined {
  const pane = findPane(state, paneId);
  if (!pane) return undefined;
  const existing = pane.tabs.find((t) => t.rootId === view.rootId);
  if (existing) {
    let next = focusTab(state, paneId, existing.id);
    if (!opts.preview && existing.preview)
      next = updateTab(next, existing.id, (t) => ({ ...t, preview: false }));
    return { state: next, tabId: existing.id };
  }
  const preview = opts.preview ? pane.tabs.find((t) => t.preview) : undefined;
  const tab = makeTab(makeId(), view, opts.preview);
  let tabs: WorkbenchTab[];
  if (preview) {
    tabs = pane.tabs.map((t) => (t.id === preview.id ? tab : t));
  } else {
    const at = pane.tabs.findIndex((t) => t.id === pane.activeTabId);
    tabs = [...pane.tabs];
    tabs.splice(at < 0 ? tabs.length : at + 1, 0, tab);
  }
  return {
    state: {
      panes: state.panes.map((p) =>
        p.id === paneId ? { ...p, tabs, activeTabId: tab.id } : p,
      ),
    },
    tabId: tab.id,
  };
}

/** Turn a preview tab into a pinned one. */
export function pinTab(state: WorkbenchState, tabId: string): WorkbenchState {
  return updateTab(state, tabId, (t) =>
    t.preview ? { ...t, preview: false } : t,
  );
}

/** Remove a tab from its pane, picking the neighbour (right, else left) as the
 *  new active tab. A pane left empty closes -- unless it is the last one,
 *  which stays as the empty state. */
export function closeTab(state: WorkbenchState, tabId: string): WorkbenchState {
  const pane = state.panes.find((p) => p.tabs.some((t) => t.id === tabId));
  if (!pane) return state;
  const i = pane.tabs.findIndex((t) => t.id === tabId);
  const tabs = pane.tabs.filter((t) => t.id !== tabId);
  if (tabs.length === 0 && state.panes.length > 1)
    return { panes: state.panes.filter((p) => p.id !== pane.id) };
  const activeTabId =
    pane.activeTabId === tabId
      ? ((tabs[i] ?? tabs[i - 1])?.id ?? null)
      : pane.activeTabId;
  return {
    panes: state.panes.map((p) =>
      p.id === pane.id ? { ...p, tabs, activeTabId } : p,
    ),
  };
}

/** A new pane to the right of `paneId`, showing a pinned copy of its active
 *  tab's view. Undefined at {@link MAX_PANES} or for an empty pane. */
export function splitPane(
  state: WorkbenchState,
  paneId: string,
  makeTabId: MakeId,
  makePaneId: MakeId,
): { state: WorkbenchState; paneId: string; tabId: string } | undefined {
  if (state.panes.length >= MAX_PANES) return undefined;
  const i = state.panes.findIndex((p) => p.id === paneId);
  const source = state.panes[i];
  const tab = source ? activeTabOf(source) : undefined;
  if (!source || !tab) return undefined;
  const copy = makeTab(makeTabId(), { rootId: tab.rootId, q: tab.q });
  const pane: WorkbenchPane = {
    id: makePaneId(),
    tabs: [copy],
    activeTabId: copy.id,
    width: source.width,
  };
  const panes = [...state.panes];
  panes.splice(i + 1, 0, pane);
  return { state: { panes }, paneId: pane.id, tabId: copy.id };
}

/**
 * Move a tab to `toPaneId`, before `beforeTabId` (null = last), and make it
 * active there. Reorders within a pane too. A source pane left empty closes.
 */
export function moveTab(
  state: WorkbenchState,
  tabId: string,
  toPaneId: string,
  beforeTabId: string | null,
): WorkbenchState {
  const from = state.panes.find((p) => p.tabs.some((t) => t.id === tabId));
  const to = findPane(state, toPaneId);
  const tab = from?.tabs.find((t) => t.id === tabId);
  if (!from || !to || !tab || tabId === beforeTabId) return state;
  // The target column already shows that root: focus its tab instead of
  // holding the same view twice (the moved tab closes).
  const twin =
    from.id === toPaneId
      ? undefined
      : to.tabs.find(
          (t) => t.rootId === tab.rootId && t.q === tab.q && t.id !== tab.id,
        );
  if (twin) return focusTab(closeTab(state, tabId), toPaneId, twin.id);
  let panes = state.panes.map((p) => {
    if (p.id !== from.id) return p;
    const tabs = p.tabs.filter((t) => t.id !== tabId);
    const i = p.tabs.findIndex((t) => t.id === tabId);
    const activeTabId =
      p.activeTabId === tabId
        ? ((tabs[i] ?? tabs[i - 1])?.id ?? null)
        : p.activeTabId;
    return { ...p, tabs, activeTabId };
  });
  panes = panes.map((p) => {
    if (p.id !== toPaneId) return p;
    const tabs = [...p.tabs];
    const at =
      beforeTabId === null ? -1 : tabs.findIndex((t) => t.id === beforeTabId);
    tabs.splice(at < 0 ? tabs.length : at, 0, tab);
    return { ...p, tabs, activeTabId: tabId };
  });
  if (from.id !== toPaneId && panes.length > 1)
    panes = panes.filter((p) => p.id !== from.id || p.tabs.length > 0);
  return { panes };
}

/** Close every tab whose root `isGone` (a deleted note or zoomed node). */
export function closeTabsWhere(
  state: WorkbenchState,
  isGone: (rootId: string) => boolean,
): WorkbenchState {
  let next = state;
  for (const pane of state.panes)
    for (const tab of pane.tabs)
      if (tab.rootId !== null && isGone(tab.rootId))
        next = closeTab(next, tab.id);
  return next;
}

/** Set every pane's relative width (missing ids keep theirs). */
export function setPaneWidths(
  state: WorkbenchState,
  widths: ReadonlyMap<string, number>,
): WorkbenchState {
  const panes = state.panes.map((p) => {
    const w = widths.get(p.id);
    return w !== undefined && w > 0 && w !== p.width ? { ...p, width: w } : p;
  });
  return panes.every((p, i) => p === state.panes[i]) ? state : { panes };
}

// --- URL shape --------------------------------------------------------------

/** The search params an outline URL carries. */
export interface OutlineSearch {
  q?: string;
  focus?: "last";
}

/** The view an outline URL names. `nodeId` is the `/$nodeId` param (null on
 *  `/`). */
export function viewFromUrl(
  nodeId: string | null,
  search: OutlineSearch,
): TabView {
  return { rootId: nodeId, q: search.q?.trim() ?? "" };
}

/** Whether the URL already shows `view` (so no write is needed). */
export function urlShowsView(
  nodeId: string | null,
  search: OutlineSearch,
  view: TabView,
): boolean {
  return sameView(viewFromUrl(nodeId, search), view);
}

import { useCallback, useSyncExternalStore } from "react";
import { flushSync } from "react-dom";

import { getNodeActionBridge } from "../data/command-bridge";
import { setCaptureListener } from "../data/history";
import {
  DEFAULT_PANE_ID,
  getActivePaneId,
  setActivePaneId,
} from "../data/panes";
import { forgetSelectionFillPane } from "../data/selection-fill";
import { childrenOf } from "../data/tree";
import { getTreeIndex } from "../data/tree-store";
import { forgetPaneView, getViewIsHiddenFor } from "../data/view-state";
import { hasMatchMedia, hasWindow, isBrowser } from "../env";
import {
  activeTab,
  activeTabOf,
  applyUrlResolution,
  closeTab,
  closeTabsWhere,
  defaultLayout,
  findPane,
  focusTab,
  moveTab,
  openTab,
  pinTab,
  resolveUrlChange,
  setPaneWidths,
  setTabView,
  splitPane,
  updateTab,
  zoomTab,
  type TabView,
  type UrlChange,
  type WorkbenchState,
  type WorkbenchTab,
} from "./model";

/**
 * The live workbench layout (docs/workbench/PLAN.md 2.2): the panes on
 * screen, their tabs, and each tab's view. A module store read with
 * `useSyncExternalStore`, like the tree store -- the layout is app chrome,
 * not outline data, so it never touches a collection. Every change goes
 * through a rule in `model.ts`; this module only holds the value, the
 * one-shot zoom intents, and the pending URL write `url-sync.ts` performs.
 *
 * The active pane id lives in `data/panes.ts`, where event-time readers can
 * reach it without importing React chrome.
 */

let seq = 0;
/** Tab ids are only unique within the page (layout persistence re-keys). */
export function newTabId(): string {
  seq += 1;
  return `t${seq}`;
}

let paneSeq = 0;
/** A pane id unique within the layout; never the default pane's. */
export function newPaneId(): string {
  let id: string;
  do {
    paneSeq += 1;
    id = `p${paneSeq}`;
  } while (state.panes.some((p) => p.id === id));
  return id;
}

let state: WorkbenchState = defaultLayout(DEFAULT_PANE_ID, newTabId());
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

function commit(next: WorkbenchState): void {
  if (next === state) return;
  // A closed pane's per-pane mirrors go with it, and the active pane always
  // names a live one.
  for (const pane of state.panes) {
    if (next.panes.some((p) => p.id === pane.id)) continue;
    forgetPaneView(pane.id);
    forgetSelectionFillPane(pane.id);
  }
  if (!next.panes.some((p) => p.id === getActivePaneId())) {
    const fallback = next.panes[0];
    if (fallback) setActivePaneId(fallback.id);
  }
  state = next;
  noteRecent(next);
  for (const l of listeners) l();
}

// --- recently opened roots (for an empty pane) ---------------------------------

const RECENT_MAX = 8;
let recent: string[] = [];

function noteRecent(next: WorkbenchState): void {
  let changed = false;
  for (const pane of next.panes) {
    const root = activeTabOf(pane)?.rootId;
    if (!root || recent[0] === root) continue;
    recent = [root, ...recent.filter((id) => id !== root)].slice(0, RECENT_MAX);
    changed = true;
  }
  if (changed) for (const l of recentListeners) l();
}

const recentListeners = new Set<() => void>();
const subscribeRecent = (l: () => void) => {
  recentListeners.add(l);
  return () => {
    recentListeners.delete(l);
  };
};
const getRecent = () => recent;
const NO_RECENT: string[] = [];

/** Roots opened most recently, newest first (this page only). */
export function useRecentRoots(): string[] {
  return useSyncExternalStore(subscribeRecent, getRecent, () => NO_RECENT);
}

/** Replace the layout wholesale (layout restore, tests). */
export function setWorkbenchState(next: WorkbenchState): void {
  commit(next);
}

export function useWorkbenchState(): WorkbenchState {
  return useSyncExternalStore(
    subscribeWorkbench,
    getWorkbenchState,
    getWorkbenchState,
  );
}

/** The active tab of `paneId`, reactively (re-renders only when that tab
 *  object changes). Undefined once the pane is gone. */
export function usePaneTab(paneId: string): WorkbenchTab | undefined {
  const get = useCallback(() => activeTab(state, paneId), [paneId]);
  return useSyncExternalStore(subscribeWorkbench, get, get);
}

/** The active tab of the ACTIVE pane, for chrome outside every pane (the
 *  Cmd+K command center). */
export function getActivePaneTab(): WorkbenchTab | undefined {
  return activeTab(state, getActivePaneId());
}

// --- the sidebar (per device, saved with the layout) ---------------------------

export interface SidebarState {
  open: boolean;
  width: number;
}

export const SIDEBAR_MIN = 180;
export const SIDEBAR_MAX = 480;
let sidebar: SidebarState = { open: true, width: 240 };
const sidebarListeners = new Set<() => void>();

export function getSidebarState(): SidebarState {
  return sidebar;
}

export function subscribeSidebar(listener: () => void): () => void {
  sidebarListeners.add(listener);
  return () => {
    sidebarListeners.delete(listener);
  };
}

export function setSidebarState(next: Partial<SidebarState>): void {
  const width =
    next.width === undefined
      ? sidebar.width
      : Math.round(Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, next.width)));
  const open = next.open ?? sidebar.open;
  if (open === sidebar.open && width === sidebar.width) return;
  sidebar = { open, width };
  for (const l of sidebarListeners) l();
}

export function toggleSidebar(): void {
  setSidebarState({ open: !sidebar.open });
}

export function useSidebarState(): SidebarState {
  return useSyncExternalStore(
    subscribeSidebar,
    getSidebarState,
    getSidebarState,
  );
}

// --- one-shot zoom intents ---------------------------------------------------

/**
 * What the editor that mounts for a tab's new view should do once: name the
 * zoom pivot (the node morphing between title and list item) and land focus
 * by it, land the caret on the last child (`/today?focus=last`), and either
 * start at the top or restore the scroll offset it left. An intent object is
 * consumed by identity, so a later remount of the same view (a layout change)
 * never replays it.
 */
export interface ZoomIntent {
  pivotId: string | null;
  focusLast: boolean;
  scroll: "top" | "restore";
  /** Focus the zoomed title with its text selected (a new note, ready to be
   *  named). */
  selectTitle: boolean;
}

const intents = new Map<string, ZoomIntent>();
const consumed = new WeakSet<ZoomIntent>();

/** The tab's pending intent, or null once consumed. Pure read: safe in render. */
export function peekZoomIntent(tabId: string): ZoomIntent | null {
  const intent = intents.get(tabId);
  return intent && !consumed.has(intent) ? intent : null;
}

/** Mark an intent done (the editor's mount effect calls this). */
export function consumeZoomIntent(intent: ZoomIntent): void {
  consumed.add(intent);
}

function setIntent(tabId: string, intent: Partial<ZoomIntent>): void {
  intents.set(tabId, {
    pivotId: null,
    focusLast: false,
    scroll: "top",
    selectTitle: false,
    ...intent,
  });
}

// --- per-view scroll memory --------------------------------------------------

const scrollMemory = new Map<string, number>();
const scrollKey = (tabId: string, rootId: string | null) =>
  `${tabId}:${rootId ?? ""}`;

/** Remember where a tab's view was scrolled (the editor saves on unmount). */
export function rememberScroll(
  tabId: string,
  rootId: string | null,
  top: number,
): void {
  scrollMemory.set(scrollKey(tabId, rootId), top);
}

export function recalledScroll(
  tabId: string,
  rootId: string | null,
): number | undefined {
  return scrollMemory.get(scrollKey(tabId, rootId));
}

// --- the pending URL write ---------------------------------------------------

/** How the next URL write should land: a zoom pushes a history entry, a tab
 *  switch or a filter keystroke replaces it (PLAN 1.7). */
let urlWrite: "push" | "replace" = "replace";

/** Read and reset the pending URL write mode (url-sync.ts). */
export function takeUrlWriteMode(): "push" | "replace" {
  const mode = urlWrite;
  urlWrite = "replace";
  return mode;
}

// --- actions -------------------------------------------------------------------

function prefersReducedMotion(): boolean {
  return (
    hasWindow() &&
    hasMatchMedia() &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * Run `update` as the zoom view transition (the shared-element morph between
 * a node's title and list-item roles). The DOM must change synchronously
 * inside the transition callback, hence flushSync. Falls back to a plain
 * update where the API is missing or motion is reduced.
 */
function withZoomTransition(update: () => void): void {
  if (
    !isBrowser() ||
    !("startViewTransition" in document) ||
    prefersReducedMotion()
  ) {
    update();
    return;
  }
  const run = () => flushSync(update);
  try {
    document.startViewTransition({ update: run, types: ["zoom"] });
  } catch {
    // Older engines take only the callback form (no transition types).
    document.startViewTransition(run);
  }
}

/**
 * Zoom `paneId`'s active tab to `rootId` (PLAN 2.4): the editor remounts on
 * the new root, the old view goes on the tab's back stack, and -- when the
 * pane is active -- the URL pushes a history entry. `pivot` names the morph
 * target and drives the post-zoom focus landing; `transition` animates it.
 */
export function zoomPane(
  paneId: string,
  rootId: string | null,
  opts: {
    pivot?: string | null;
    transition?: boolean;
    selectTitle?: boolean;
  } = {},
): void {
  const zoomed = (from: WorkbenchState) => {
    const tab = activeTab(from, paneId);
    if (!tab) return null;
    const next = updateTab(from, tab.id, (t) => zoomTab(t, { rootId, q: "" }));
    return next === from ? null : { tab, next };
  };
  if (!zoomed(state)) return;
  // Computed when applied, not now: a view transition runs `apply` later,
  // and a second zoom or URL change may have landed in between.
  const apply = () => {
    const change = zoomed(state);
    if (!change) return;
    setIntent(change.tab.id, {
      pivotId: opts.pivot ?? null,
      selectTitle: opts.selectTitle ?? false,
    });
    scrollMemory.delete(scrollKey(change.tab.id, rootId));
    if (paneId === getActivePaneId()) urlWrite = "push";
    commit(change.next);
  };
  if (opts.transition && paneId === getActivePaneId())
    withZoomTransition(apply);
  else apply();
}

/** Set `paneId`'s active-tab filter (`?q=`). A live-as-you-type edit
 *  replaces the URL; a committed one (a chip click) pushes. */
export function setPaneFilter(
  paneId: string,
  q: string,
  opts: { replace?: boolean } = {},
): void {
  const tab = activeTab(state, paneId);
  if (!tab) return;
  const next = updateTab(state, tab.id, (t) =>
    setTabView(t, { rootId: t.rootId, q: q.trim() }),
  );
  if (next === state) return;
  if (paneId === getActivePaneId() && !opts.replace) urlWrite = "push";
  commit(next);
}

/**
 * Follow a URL change the workbench did not make itself (PLAN 1.7): a browser
 * back/forward, the page opening on a deep link, or another surface calling
 * `navigate`. `focusLast` is the `/today` write intent.
 */
export function followUrl(
  change: UrlChange,
  target: TabView,
  focusLast: boolean,
): void {
  const resolution = resolveUrlChange(state, getActivePaneId(), target, change);
  if (!resolution) return;
  const before =
    resolution.kind === "open"
      ? undefined
      : activeTab(state, resolution.paneId);
  const result = applyUrlResolution(state, resolution, target, newTabId);
  const after = activeTab(result.state, result.paneId);
  const moved =
    after !== undefined &&
    (before?.id !== after.id || before.rootId !== after.rootId);
  if (moved) {
    setIntent(result.tabId, {
      focusLast,
      // Browser back lands on the node you came out of, forward on the first
      // child of the node you go into -- what a zoom out / in would do.
      pivotId:
        resolution.kind === "back"
          ? (before?.rootId ?? null)
          : resolution.kind === "forward"
            ? target.rootId
            : null,
      scroll:
        resolution.kind === "zoom" || resolution.kind === "open"
          ? "top"
          : "restore",
    });
  } else if (focusLast && target.rootId !== null) {
    // Already showing it (the Today button on today's note): no remount will
    // read an intent, so land the caret now.
    const isHidden = getViewIsHiddenFor(result.paneId);
    const last = childrenOf(getTreeIndex(), target.rootId)
      .filter((n) => !isHidden(n))
      .at(-1);
    if (last) getNodeActionBridge(result.paneId)?.focusNode(last.id);
  }
  if (resolution.kind === "zoom")
    scrollMemory.delete(scrollKey(result.tabId, target.rootId));
  setActivePaneId(result.paneId);
  commit(result.state);
}

// --- tabs and panes (PLAN 1.3) -------------------------------------------------

/**
 * Open `rootId` in `paneId` (PLAN 1.3): a preview open (a sidebar click)
 * replaces the pane's preview tab; a pinned open (double-click, Cmd/Ctrl+
 * click, a drop) adds a tab; a root already open in the pane is focused. The
 * pane becomes active.
 */
export function openInPane(
  paneId: string,
  rootId: string | null,
  opts: { preview: boolean; selectTitle?: boolean },
): void {
  const result = openTab(state, paneId, { rootId, q: "" }, opts, newTabId);
  if (!result) return;
  const before = activeTab(state, paneId);
  if (before?.id !== result.tabId || before.rootId !== rootId)
    setIntent(result.tabId, {
      scroll: "restore",
      selectTitle: opts.selectTitle ?? false,
    });
  setActivePaneId(paneId);
  commit(result.state);
}

/** Pin a preview tab (double-clicking it, or any write into it). */
export function pinTabById(tabId: string): void {
  commit(pinTab(state, tabId));
}

/** Close a tab; its pane closes with its last tab unless it is the last pane. */
export function closeTabById(tabId: string): void {
  commit(closeTab(state, tabId));
}

/** Make a tab (and its pane) active. Switching tabs replaces the URL. */
export function focusTabById(paneId: string, tabId: string): void {
  const pane = findPane(state, paneId);
  if (!pane) return;
  if (pane.activeTabId !== tabId) setIntent(tabId, { scroll: "restore" });
  setActivePaneId(paneId);
  commit(focusTab(state, paneId, tabId));
}

/** Make a pane active (its editor keeps whatever it had). */
export function focusPane(paneId: string): void {
  if (!findPane(state, paneId)) return;
  setActivePaneId(paneId);
  // The URL follows the active tab: nudge the URL sync even though the layout
  // itself did not change.
  for (const l of listeners) l();
}

/** Split the active pane: a new column to its right, showing the same view.
 *  Returns false at four columns. */
export function splitActivePane(): boolean {
  const result = splitPane(state, getActivePaneId(), newTabId, newPaneId);
  if (!result) return false;
  setActivePaneId(result.paneId);
  commit(result.state);
  return true;
}

/** Move a tab to another pane's tab bar (or reorder it in its own). */
export function moveTabTo(
  tabId: string,
  toPaneId: string,
  beforeTabId: string | null,
): void {
  setIntent(tabId, { scroll: "restore" });
  setActivePaneId(toPaneId);
  commit(moveTab(state, tabId, toPaneId, beforeTabId));
}

/** Close every tab showing a node that `isGone` (PLAN 1.6). */
export function closeTabsShowing(isGone: (rootId: string) => boolean): void {
  commit(closeTabsWhere(state, isGone));
}

/** Set the panes' relative widths; equal when `widths` is empty. */
export function setWidths(widths: ReadonlyMap<string, number>): void {
  if (widths.size === 0) {
    commit(setPaneWidths(state, new Map(state.panes.map((p) => [p.id, 1]))));
    return;
  }
  commit(setPaneWidths(state, widths));
}

/** Focus the pane `delta` columns from the active one (clamped). */
export function focusAdjacentPane(delta: number): void {
  const i = state.panes.findIndex((p) => p.id === getActivePaneId());
  const target =
    state.panes[Math.max(0, Math.min(state.panes.length - 1, i + delta))];
  if (target) focusPane(target.id);
}

/** Focus the Nth column (0-based), if it exists. */
export function focusPaneAt(n: number): void {
  const target = state.panes[n];
  if (target) focusPane(target.id);
}

/** Step the active pane's active tab `delta` tabs, wrapping. */
export function cycleTab(delta: number): void {
  const pane = findPane(state, getActivePaneId());
  if (!pane || pane.tabs.length < 2) return;
  const i = pane.tabs.findIndex((t) => t.id === pane.activeTabId);
  const next = pane.tabs[(i + delta + pane.tabs.length) % pane.tabs.length];
  if (next) focusTabById(pane.id, next.id);
}

/** Close the active pane's active tab. */
export function closeActiveTab(): void {
  const tab = activeTab(state, getActivePaneId());
  if (tab) closeTabById(tab.id);
}

/** Pin the active pane's active tab. */
export function pinActiveTab(): void {
  const tab = activeTab(state, getActivePaneId());
  if (tab) pinTabById(tab.id);
}

// A write pins the preview tab it lands in (PLAN 1.3): the tab the capture
// names, or -- for a capture without a location -- the active pane's. A
// location without a tab (quick-add) writes elsewhere and pins nothing.
setCaptureListener((location) => {
  const tabId = location
    ? location.tabId
    : activeTab(state, getActivePaneId())?.id;
  if (!tabId) return;
  const next = pinTab(state, tabId);
  if (next !== state) commit(next);
});

/**
 * Show `rootId` for a history restore (PLAN 2.8): back in the tab the edit
 * happened in when it is still open, else in the active pane. Returns the pane
 * that now shows it. The view change is flushed synchronously so the restored
 * editor is mounted before the caller lands focus.
 */
export function showForRestore(
  rootId: string | null,
  paneId: string | undefined,
  tabId: string | undefined,
): string {
  const home =
    paneId && tabId
      ? state.panes.find(
          (p) => p.id === paneId && p.tabs.some((t) => t.id === tabId),
        )
      : undefined;
  const targetPane = home?.id ?? getActivePaneId();
  let next = home && tabId ? focusTab(state, home.id, tabId) : state;
  const tab = activeTab(next, targetPane);
  const zooms = tab !== undefined && tab.rootId !== rootId;
  if (tab && zooms) {
    next = updateTab(next, tab.id, (t) => zoomTab(t, { rootId, q: t.q }));
    setIntent(tab.id, { scroll: "top" });
  }
  setActivePaneId(targetPane);
  if (next !== state) {
    // A zoom pushes a history entry; only switching tabs replaces.
    urlWrite = zooms ? "push" : "replace";
    flushSync(() => commit(next));
  }
  return targetPane;
}

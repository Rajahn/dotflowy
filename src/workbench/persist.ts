import { Option, Schema } from "effect";

import type { WorkbenchState } from "./model";

/**
 * The workbench layout, saved per device and per account
 * (docs/workbench/PLAN.md 1.8): panes (id, width, tabs, active tab), the
 * active pane, and the sidebar. A tab saves only its id, root, preview flag
 * and filter -- never its back/forward stacks. Unreadable or mismatched data
 * falls back to the default layout; every storage call is guarded, because
 * private windows and blocked site data throw.
 */

const KEY_PREFIX = "dotflowy:workbench-layout:v1:";

const SavedTabSchema = Schema.Struct({
  id: Schema.String,
  rootId: Schema.NullOr(Schema.String),
  preview: Schema.Boolean,
  q: Schema.String,
});

const SavedPaneSchema = Schema.Struct({
  id: Schema.String,
  width: Schema.Number,
  tabs: Schema.Array(SavedTabSchema),
  activeTabId: Schema.NullOr(Schema.String),
});

const SavedLayoutSchema = Schema.Struct({
  panes: Schema.Array(SavedPaneSchema),
  activePaneId: Schema.String,
  sidebar: Schema.Struct({ open: Schema.Boolean, width: Schema.Number }),
});

export type SavedLayout = Schema.Schema.Type<typeof SavedLayoutSchema>;

const decodeSaved = Schema.decodeUnknownOption(
  Schema.fromJsonString(SavedLayoutSchema),
);

export interface SidebarLayout {
  open: boolean;
  width: number;
}

/** The layout as saved: tabs lose their history. */
export function toSaved(
  state: WorkbenchState,
  activePaneId: string,
  sidebar: SidebarLayout,
): SavedLayout {
  return {
    panes: state.panes.map((p) => ({
      id: p.id,
      width: p.width,
      tabs: p.tabs.map((t) => ({
        id: t.id,
        rootId: t.rootId,
        preview: t.preview,
        q: t.q,
      })),
      activeTabId: p.activeTabId,
    })),
    activePaneId,
    sidebar,
  };
}

/**
 * A saved layout back as live state, with fresh tab ids from `makeTabId` (a
 * restored id could collide with ones this page already issued). Undefined
 * when the saved data holds no pane; panes keep at least their shape (an
 * empty pane is the empty state), and an active pane that is gone falls back
 * to the first.
 */
export function fromSaved(
  saved: SavedLayout,
  makeTabId: () => string,
): { state: WorkbenchState; activePaneId: string } | undefined {
  if (saved.panes.length === 0) return undefined;
  const panes = saved.panes.slice(0, 4).map((p) => {
    const ids = new Map(p.tabs.map((t) => [t.id, makeTabId()]));
    const tabs = p.tabs.map((t) => ({
      id: ids.get(t.id)!,
      rootId: t.rootId,
      q: t.q,
      preview: t.preview,
      back: [],
      forward: [],
    }));
    const activeTabId =
      (p.activeTabId !== null ? ids.get(p.activeTabId) : undefined) ??
      tabs[0]?.id ??
      null;
    return {
      id: p.id,
      tabs,
      activeTabId,
      width: p.width > 0 ? p.width : 1,
    };
  });
  const activePaneId = panes.some((p) => p.id === saved.activePaneId)
    ? saved.activePaneId
    : panes[0]!.id;
  return { state: { panes }, activePaneId };
}

export function loadLayout(userId: string): SavedLayout | undefined {
  try {
    const raw = window.localStorage.getItem(KEY_PREFIX + userId);
    if (!raw) return undefined;
    return Option.getOrUndefined(decodeSaved(raw));
  } catch {
    return undefined;
  }
}

export function saveLayout(userId: string, layout: SavedLayout): void {
  try {
    window.localStorage.setItem(KEY_PREFIX + userId, JSON.stringify(layout));
  } catch {
    // Storage unavailable: the layout simply isn't remembered.
  }
}

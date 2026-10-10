import { createContext, useContext, useMemo, type ReactNode } from "react";

import { DEFAULT_PANE_ID } from "../data/panes";

/**
 * What an editor needs to know about the workbench pane it renders in
 * (docs/workbench/PLAN.md 2.2). Its id keys per-pane view state, virtual nav,
 * the command bridge and selection fill; `windowScroll` says whether the
 * window scrolls the outline (narrow screens) or the pane root does
 * (pane-scroll.ts). The default is the single pane every layout starts with,
 * scrolled by its pane root -- so a component rendered outside a provider (a
 * test harness) needs a `[data-pane-scroll]` ancestor, or a provider with
 * `windowScroll`.
 */
export interface PaneContextValue {
  paneId: string;
  windowScroll: boolean;
}

const PaneContext = createContext<PaneContextValue>({
  paneId: DEFAULT_PANE_ID,
  windowScroll: false,
});

export function PaneProvider({
  paneId,
  windowScroll,
  children,
}: Readonly<{ paneId: string; windowScroll: boolean; children: ReactNode }>) {
  // Stable value: every memoized OutlineRow reads this context, so a fresh
  // object per render would re-render the whole window (ADR 0014).
  const value = useMemo(
    () => ({ paneId, windowScroll }),
    [paneId, windowScroll],
  );
  return <PaneContext value={value}>{children}</PaneContext>;
}

/** The id of the pane this component renders in. */
export function usePaneId(): string {
  return useContext(PaneContext).paneId;
}

/** Whether the window (not the pane root) scrolls this pane's outline. */
export function usePaneWindowScroll(): boolean {
  return useContext(PaneContext).windowScroll;
}

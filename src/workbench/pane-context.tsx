import { createContext, useContext, useMemo, type ReactNode } from "react";

import { DEFAULT_PANE_ID } from "../data/panes";

/**
 * What an editor needs to know about the workbench pane it renders in
 * (docs/workbench/PLAN.md 2.2). Today that is only its id: per-pane view
 * state, virtual nav, the command bridge and selection fill are keyed by it.
 * The default is the single pane every layout starts with, so a component
 * rendered outside a provider (a test harness) behaves as before.
 */
export interface PaneContextValue {
  paneId: string;
}

const PaneContext = createContext<PaneContextValue>({
  paneId: DEFAULT_PANE_ID,
});

export function PaneProvider({
  paneId,
  children,
}: Readonly<{ paneId: string; children: ReactNode }>) {
  // Stable value: every memoized OutlineRow reads this context, so a fresh
  // object per render would re-render the whole window (ADR 0014).
  const value = useMemo(() => ({ paneId }), [paneId]);
  return <PaneContext value={value}>{children}</PaneContext>;
}

/** The id of the pane this component renders in. */
export function usePaneId(): string {
  return useContext(PaneContext).paneId;
}

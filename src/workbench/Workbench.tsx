import { useHotkey } from "@tanstack/react-hotkeys";
import { useEffect } from "react";

import { OutlineEditor } from "../components/OutlineEditor";
import { installLiteralPasteArm } from "../components/paste";
import { paneIdOf, setActivePaneId } from "../data/panes";
import { useIsMobile } from "../hooks/use-mobile";
import { dispatchPaneAction } from "./pane-actions";
import { PaneProvider } from "./pane-context";
import { useWorkbenchState } from "./store";

/**
 * The workbench: every pane (column) of the layout, each an `OutlineEditor`
 * inside its own `PaneProvider` and `[data-pane-id]` root, plus the window-
 * level wiring that must exist once per page, not once per editor
 * (docs/workbench/PLAN.md 2.2). Today the layout holds a single pane and the
 * route still owns its zoom root.
 */
export function Workbench({ rootId }: Readonly<{ rootId: string | null }>) {
  const { panes } = useWorkbenchState();
  // Narrow screens keep page scrolling (pane-scroll.ts); wide ones scroll each
  // pane root on its own.
  const windowScroll = useIsMobile();
  return (
    <>
      <WorkbenchHost />
      {panes.map((pane) => (
        <PaneProvider
          key={pane.id}
          paneId={pane.id}
          windowScroll={windowScroll}
        >
          <main
            data-pane-id={pane.id}
            data-pane-scroll={windowScroll ? undefined : ""}
            className={
              windowScroll
                ? undefined
                : "h-dvh [scrollbar-gutter:stable] overflow-y-auto"
            }
          >
            {/* Key by the zoom root so each zoom view mounts a fresh editor
                (and a fresh title element; prevents a suppressed
                view-transition-name from leaking between consecutive
                zooms), and by the scroll mode, which the editor's
                virtualizer fixes at mount. */}
            <OutlineEditor
              key={`${rootId ?? ""}:${windowScroll}`}
              rootId={rootId}
            />
          </main>
        </PaneProvider>
      ))}
    </>
  );
}

/**
 * Window-level wiring, mounted once beside the panes:
 *  - the active pane follows a capture-phase pointerdown/focusin, so it has
 *    already moved by the time any element handler or keydown runs;
 *  - undo, redo and zoom-out register ONCE and dispatch to the active pane's
 *    editor (pane-actions.ts), instead of firing once per mounted editor;
 *  - the literal-paste chord (ADR 0044) is armed once.
 */
function WorkbenchHost() {
  useEffect(() => {
    const follow = (e: Event) => {
      const paneId = paneIdOf(e.target instanceof Element ? e.target : null);
      if (paneId) setActivePaneId(paneId);
    };
    window.addEventListener("pointerdown", follow, true);
    window.addEventListener("focusin", follow, true);
    return () => {
      window.removeEventListener("pointerdown", follow, true);
      window.removeEventListener("focusin", follow, true);
    };
  }, []);

  useEffect(() => installLiteralPasteArm(), []);

  // Cmd/Ctrl+Z / Cmd/Ctrl+Shift+Z: undo/redo, owning history over the
  // browser's native contentEditable undo (preventDefault).
  useHotkey("Mod+Z", () => dispatchPaneAction("undo"), {
    preventDefault: true,
  });
  useHotkey("Mod+Shift+Z", () => dispatchPaneAction("redo"), {
    preventDefault: true,
  });
  // Cmd/Ctrl+,: zoom the active pane out one level. Mirror of Cmd+. (zoom in).
  useHotkey("Mod+,", () => dispatchPaneAction("zoomOut"), {
    preventDefault: true,
  });
  return null;
}

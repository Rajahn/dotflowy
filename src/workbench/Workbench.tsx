import { useHotkey } from "@tanstack/react-hotkeys";
import { Columns2Icon, PanelLeftIcon, XIcon } from "lucide-react";
import {
  Fragment,
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";

import { OutlineEditor } from "../components/OutlineEditor";
import { installLiteralPasteArm } from "../components/paste";
import { getNodeActionBridge } from "../data/command-bridge";
import { libraryNoteRoot } from "../data/library";
import { flattenNodeText } from "../data/node-links";
import {
  getPaneFocus,
  paneElement,
  paneIdOf,
  rememberPaneFocus,
  setActivePaneId,
} from "../data/panes";
import { getTreeIndex, useNode, useTrail } from "../data/tree-store";
import { useIsMobile } from "../hooks/use-mobile";
import { moveToAdjacentColumn } from "./column-move-action";
import {
  hasLibraryDrag,
  hasTabDrag,
  readLibraryDrag,
  readTabDrag,
  startTabDrag,
} from "./dnd";
import { useActivePaneId } from "./hooks";
import { useWorkbenchLifecycle } from "./lifecycle";
import {
  activeTabOf,
  MAX_PANES,
  type WorkbenchPane,
  type WorkbenchTab,
} from "./model";
import { dispatchPaneAction } from "./pane-actions";
import { PaneProvider } from "./pane-context";
import { Sidebar } from "./Sidebar";
import {
  closeActiveTab,
  closeTabById,
  cycleTab,
  focusAdjacentPane,
  focusPaneAt,
  focusTabById,
  moveTabTo,
  openInPane,
  pinTabById,
  setSidebarState,
  setWidths,
  splitActivePane,
  toggleSidebar,
  useRecentRoots,
  useSidebarState,
  useWorkbenchState,
} from "./store";
import { useWorkbenchUrlSync } from "./url-sync";

/** Columns never shrink below this; the workbench scrolls sideways instead. */
const PANE_MIN_PX = 280;

/**
 * The workbench (docs/workbench/PLAN.md 1.3): the notes sidebar, then one to
 * four panes (columns) left to right, each with its tabs and an
 * `OutlineEditor` for the active one, plus the window-level wiring that must
 * exist once per page (PLAN 2.2). Mounted by the root route for `/` and
 * `/$nodeId` and kept mounted across them, so a zoom never remounts a column
 * it did not change. Each pane's view comes from its active tab (store.ts);
 * the URL follows the active tab (url-sync.ts).
 *
 * A narrow screen (< 768px) shows only the active pane and keeps page
 * scrolling (PLAN 1.9).
 */
export function Workbench() {
  const { panes } = useWorkbenchState();
  const activePaneId = useActivePaneId();
  const sidebar = useSidebarState();
  const windowScroll = useIsMobile();
  // Order matters: the saved layout is restored (a layout effect) before the
  // URL sync resolves the address the page opened on (a passive effect).
  useWorkbenchLifecycle();
  useWorkbenchUrlSync();

  if (windowScroll) {
    const pane = panes.find((p) => p.id === activePaneId) ?? panes[0];
    return (
      <>
        <WorkbenchHost />
        {pane && <PaneView pane={pane} active showTabs={false} windowScroll />}
      </>
    );
  }

  return (
    <>
      <WorkbenchHost />
      <div className="flex h-dvh overflow-hidden">
        {sidebar.open ? (
          <>
            <Sidebar width={sidebar.width} />
            <SidebarResizer width={sidebar.width} />
          </>
        ) : (
          <button
            type="button"
            className="flex w-8 shrink-0 items-start justify-center border-r pt-3 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Show sidebar"
            title="Show sidebar"
            onClick={() => toggleSidebar()}
          >
            <PanelLeftIcon className="size-4" />
          </button>
        )}
        <div
          className="workbench-panes flex min-w-0 flex-1 overflow-x-auto"
          data-workbench-panes=""
        >
          {panes.map((pane, i) => (
            <Fragment key={pane.id}>
              {i > 0 && <PaneSplitter left={panes[i - 1]!} right={pane} />}
              <PaneView
                pane={pane}
                active={pane.id === activePaneId}
                // One pane holding one tab needs no tab strip; the layout
                // then looks exactly like the single editor it replaced.
                showTabs={panes.length > 1 || pane.tabs.length > 1}
                windowScroll={false}
              />
            </Fragment>
          ))}
        </div>
      </div>
    </>
  );
}

// --- a pane -------------------------------------------------------------------

function PaneView({
  pane,
  active,
  showTabs,
  windowScroll,
}: {
  pane: WorkbenchPane;
  active: boolean;
  showTabs: boolean;
  windowScroll: boolean;
}) {
  const tab = activeTabOf(pane);
  const [dropping, setDropping] = useState(false);
  const editor = tab ? (
    // Key by tab and zoom root so each zoom view mounts a fresh editor (and
    // a fresh title element; prevents a suppressed view-transition-name from
    // leaking between consecutive zooms), and by the scroll mode, which the
    // editor's virtualizer fixes at mount.
    <OutlineEditor
      key={`${tab.id}:${tab.rootId ?? ""}:${windowScroll}`}
      tabId={tab.id}
      rootId={tab.rootId}
    />
  ) : (
    <EmptyPane paneId={pane.id} />
  );

  if (windowScroll) {
    return (
      <PaneProvider paneId={pane.id} windowScroll>
        <main data-pane-id={pane.id}>{editor}</main>
      </PaneProvider>
    );
  }

  return (
    <PaneProvider paneId={pane.id} windowScroll={false}>
      <section
        data-pane-id={pane.id}
        data-active-pane={active ? "" : undefined}
        aria-label="Column"
        className={cn(
          "relative flex h-dvh flex-col",
          dropping && "ring-2 ring-primary/40 ring-inset",
        )}
        style={{ flexGrow: pane.width, flexBasis: 0, minWidth: PANE_MIN_PX }}
        // A note dragged from the sidebar onto a column opens there.
        onDragOver={(e) => {
          if (!hasLibraryDrag(e)) return;
          e.preventDefault();
          // Must be one the drag allows (startLibraryDrag: move), or the
          // browser refuses the drop.
          e.dataTransfer.dropEffect = "move";
          setDropping(true);
        }}
        onDragLeave={(e) => {
          const next = e.relatedTarget;
          if (!(next instanceof Node) || !e.currentTarget.contains(next))
            setDropping(false);
        }}
        onDrop={(e) => {
          setDropping(false);
          if (openDroppedNote(e, pane.id)) e.preventDefault();
        }}
      >
        {showTabs && <TabBar pane={pane} active={active} />}
        <main
          data-pane-scroll=""
          className="min-h-0 flex-1 [scrollbar-gutter:stable] overflow-y-auto"
        >
          {editor}
        </main>
      </section>
    </PaneProvider>
  );
}

/** Open a sidebar note dropped on `paneId` as a pinned tab. True if the drop
 *  carried one. */
function openDroppedNote(e: DragEvent, paneId: string): boolean {
  if (!hasLibraryDrag(e)) return false;
  const drag = readLibraryDrag(e);
  const nodeId = !drag
    ? null
    : drag.kind === "node"
      ? drag.nodeId
      : libraryNoteRoot(drag.id);
  if (!nodeId) return false;
  openInPane(paneId, nodeId, { preview: false });
  return true;
}

function EmptyPane({ paneId }: { paneId: string }) {
  const recent = useRecentRoots();
  return (
    <div className="mx-auto flex max-w-sm flex-col gap-3 p-10 text-sm text-muted-foreground">
      <p>Open a note from the sidebar.</p>
      {recent.length > 0 && (
        <>
          <p className="text-xs font-medium">Recent</p>
          <ul className="flex flex-col gap-1">
            {recent.map((id) => (
              <li key={id}>
                <RecentLink
                  nodeId={id}
                  onOpen={() => openInPane(paneId, id, { preview: false })}
                />
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function RecentLink({
  nodeId,
  onOpen,
}: {
  nodeId: string;
  onOpen: () => void;
}) {
  const title = useTabTitle(nodeId);
  const exists = useNode(nodeId) !== undefined;
  if (!exists) return null;
  return (
    <button
      type="button"
      className="truncate text-left text-foreground underline-offset-2 hover:underline"
      onClick={onOpen}
    >
      {title}
    </button>
  );
}

// --- the tab strip ------------------------------------------------------------

function TabBar({ pane, active }: { pane: WorkbenchPane; active: boolean }) {
  const paneCount = useWorkbenchState().panes.length;
  const [dropAt, setDropAt] = useState<string | null | undefined>(undefined);
  const accepts = (e: DragEvent) => hasTabDrag(e) || hasLibraryDrag(e);
  const drop = (e: DragEvent, beforeTabId: string | null) => {
    setDropAt(undefined);
    if (hasTabDrag(e)) {
      const tabId = readTabDrag(e);
      if (!tabId) return;
      e.preventDefault();
      e.stopPropagation();
      moveTabTo(tabId, pane.id, beforeTabId);
      return;
    }
    if (openDroppedNote(e, pane.id)) {
      e.preventDefault();
      e.stopPropagation();
    }
  };
  return (
    <div
      className={cn(
        "flex h-9 shrink-0 items-stretch border-b bg-muted/40",
        active && "shadow-[inset_0_2px_0_var(--primary)]",
      )}
    >
      <div
        role="tablist"
        aria-label="Tabs"
        className="flex min-w-0 flex-1 overflow-x-auto"
        onDragOver={(e) => {
          if (!accepts(e)) return;
          e.preventDefault();
          setDropAt(null);
        }}
        onDragLeave={() => setDropAt(undefined)}
        onDrop={(e) => drop(e, null)}
      >
        {pane.tabs.map((tab) => (
          <TabButton
            key={tab.id}
            tab={tab}
            paneId={pane.id}
            selected={tab.id === pane.activeTabId}
            dropBefore={dropAt === tab.id}
            onDragOverTab={(e) => {
              if (!accepts(e)) return;
              e.preventDefault();
              e.stopPropagation();
              setDropAt(tab.id);
            }}
            onDropTab={(e) => drop(e, tab.id)}
          />
        ))}
        {dropAt === null && (
          <span aria-hidden="true" className="my-1.5 w-0.5 bg-primary" />
        )}
      </div>
      <button
        type="button"
        className="inline-flex w-9 shrink-0 items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
        aria-label="Split right"
        title={paneCount >= MAX_PANES ? "At most four columns" : "Split right"}
        disabled={paneCount >= MAX_PANES}
        onClick={() => {
          if (pane.activeTabId) focusTabById(pane.id, pane.activeTabId);
          splitActivePane();
        }}
      >
        <Columns2Icon className="size-4" />
      </button>
    </div>
  );
}

function TabButton({
  tab,
  paneId,
  selected,
  dropBefore,
  onDragOverTab,
  onDropTab,
}: {
  tab: WorkbenchTab;
  paneId: string;
  selected: boolean;
  dropBefore: boolean;
  onDragOverTab: (e: DragEvent) => void;
  onDropTab: (e: DragEvent) => void;
}) {
  const title = useTabTitle(tab.rootId);
  const path = useTabPath(tab.rootId);
  return (
    <div
      role="tab"
      aria-label={title}
      aria-selected={selected}
      tabIndex={selected ? 0 : -1}
      title={path}
      data-tab-id={tab.id}
      data-preview={tab.preview ? "" : undefined}
      draggable
      className={cn(
        "group relative flex max-w-48 min-w-0 shrink-0 cursor-default items-center gap-1 border-r px-3 text-sm select-none",
        selected
          ? "bg-background text-foreground"
          : "text-muted-foreground hover:bg-muted",
      )}
      onClick={() => focusTabById(paneId, tab.id)}
      onDoubleClick={() => pinTabById(tab.id)}
      onAuxClick={(e) => {
        if (e.button === 1) closeTabById(tab.id);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          focusTabById(paneId, tab.id);
        }
      }}
      onDragStart={(e) => startTabDrag(e, tab.id)}
      onDragOver={onDragOverTab}
      onDrop={onDropTab}
    >
      {dropBefore && (
        <span
          aria-hidden="true"
          className="absolute inset-y-1.5 left-0 w-0.5 bg-primary"
        />
      )}
      <span className={cn("truncate", tab.preview && "italic")}>{title}</span>
      <button
        type="button"
        aria-label={`Close ${title}`}
        className="-mr-1.5 inline-flex size-5 shrink-0 items-center justify-center rounded opacity-60 group-hover:opacity-100 hover:bg-muted-foreground/15"
        onClick={(e) => {
          e.stopPropagation();
          closeTabById(tab.id);
        }}
      >
        <XIcon className="size-3.5" />
      </button>
    </div>
  );
}

/** A tab's title: its root's plain reading text, or "Whole outline". */
function useTabTitle(rootId: string | null): string {
  const node = useNode(rootId ?? "");
  if (rootId === null) return "Whole outline";
  return flattenNodeText(getTreeIndex(), node?.text ?? "").trim() || "Untitled";
}

/** The hover path: note › … › node. */
function useTabPath(rootId: string | null): string {
  const trail = useTrail(rootId);
  if (rootId === null) return "Whole outline";
  const index = getTreeIndex();
  return trail
    .map((n) => flattenNodeText(index, n.text).trim() || "Untitled")
    .join(" › ");
}

// --- resizing -------------------------------------------------------------------

/**
 * The bar between two panes: drag to trade width between them (neither below
 * the minimum), double-click to make every column equal (PLAN 1.3).
 */
function PaneSplitter({
  left,
  right,
}: {
  left: WorkbenchPane;
  right: WorkbenchPane;
}) {
  const drag = useRef<{
    x: number;
    leftPx: number;
    rightPx: number;
    total: number;
  } | null>(null);
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const l = paneElement(left.id)?.getBoundingClientRect().width;
    const r = paneElement(right.id)?.getBoundingClientRect().width;
    if (!l || !r) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = {
      x: e.clientX,
      leftPx: l,
      rightPx: r,
      total: left.width + right.width,
    };
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const both = d.leftPx + d.rightPx;
    const leftPx = Math.max(
      PANE_MIN_PX,
      Math.min(both - PANE_MIN_PX, d.leftPx + e.clientX - d.x),
    );
    setWidths(
      new Map([
        [left.id, (d.total * leftPx) / both],
        [right.id, (d.total * (both - leftPx)) / both],
      ]),
    );
  };
  const stop = () => {
    drag.current = null;
  };
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize columns"
      className="w-1 shrink-0 cursor-col-resize bg-border hover:bg-primary/40"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={stop}
      onPointerCancel={stop}
      onDoubleClick={() => setWidths(new Map())}
    />
  );
}

function SidebarResizer({ width }: { width: number }) {
  const drag = useRef<{ x: number; width: number } | null>(null);
  const stop = () => {
    drag.current = null;
  };
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize sidebar"
      className="w-1 shrink-0 cursor-col-resize hover:bg-primary/40"
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { x: e.clientX, width };
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (d) setSidebarState({ width: d.width + e.clientX - d.x });
      }}
      onPointerUp={stop}
      onPointerCancel={stop}
    />
  );
}

// --- window-level wiring ----------------------------------------------------------

function isMac(): boolean {
  return /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
}

/** Put the caret back in `paneId`: where it last was, else the first row. */
function focusPaneEditor(paneId: string): void {
  requestAnimationFrame(() => {
    const key = getPaneFocus(paneId);
    const bridge = getNodeActionBridge(paneId);
    const pane = paneElement(paneId);
    if (
      key &&
      bridge &&
      pane?.querySelector(`[data-history-key="${CSS.escape(key)}"]`)
    ) {
      bridge.focusNode(key);
      return;
    }
    pane?.querySelector<HTMLElement>(".node-text")?.focus();
  });
}

/**
 * The workbench chords (PLAN 1.5; the settled list is in docs/keyboard.md).
 * Matched on `event.code`, so Option on a Mac (which types special
 * characters) and keyboard layouts don't change what a chord means.
 * Browser-reserved keys (Cmd+1..9, Cmd+W, Ctrl+Tab, Linux Alt+1..8) are
 * deliberately not used.
 */
function onWorkbenchKey(e: KeyboardEvent): boolean {
  const mac = isMac();
  const onlyCtrl = e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey;
  const onlyAlt = e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey;
  // AltGr on Windows reports Ctrl+Alt: leave it to type its character
  // ([, ], ~ on several European layouts).
  const ctrlAlt =
    e.ctrlKey &&
    e.altKey &&
    !e.metaKey &&
    !e.shiftKey &&
    !e.getModifierState("AltGraph");
  const digit = /^Digit([1-4])$/.exec(e.code);
  if (digit && (mac ? onlyCtrl : onlyAlt)) {
    focusPaneAt(Number(digit[1]) - 1);
    return true;
  }
  if (ctrlAlt && (e.code === "ArrowLeft" || e.code === "ArrowRight"))
    return moveToAdjacentColumn(e.code === "ArrowLeft" ? -1 : 1);
  if (ctrlAlt && (e.code === "BracketLeft" || e.code === "BracketRight")) {
    focusAdjacentPane(e.code === "BracketLeft" ? -1 : 1);
    return true;
  }
  const mod = mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
  if (mod && !e.altKey && !e.shiftKey && e.code === "Backslash") {
    if (!splitActivePane()) toast("At most four columns.");
    return true;
  }
  if (e.code === "KeyW" && (mac ? onlyCtrl : onlyAlt)) {
    closeActiveTab();
    return true;
  }
  if (onlyAlt && (e.code === "BracketLeft" || e.code === "BracketRight")) {
    cycleTab(e.code === "BracketLeft" ? -1 : 1);
    return true;
  }
  return false;
}

/**
 * Window-level wiring, mounted once beside the panes:
 *  - the active pane follows a capture-phase pointerdown/focusin, so it has
 *    already moved by the time any element handler or keydown runs; the row
 *    a pane last had the caret in is remembered;
 *  - undo, redo and zoom-out register ONCE and dispatch to the active pane's
 *    editor (pane-actions.ts), instead of firing once per mounted editor;
 *  - the workbench chords (split, close, focus a column, cycle tabs);
 *  - the literal-paste chord (ADR 0044) is armed once.
 */
function WorkbenchHost() {
  const activePaneId = useActivePaneId();
  const previousPane = useRef(activePaneId);
  // A press inside a column's content (a row, empty space, its scrollbar)
  // places focus itself, or deliberately none: the caret must not jump.
  const pressedContent = useRef<string | null>(null);

  useEffect(() => {
    const follow = (e: Event) => {
      const target = e.target instanceof Element ? e.target : null;
      const paneId = paneIdOf(target);
      if (!paneId) return;
      if (e.type === "pointerdown")
        pressedContent.current = target?.closest("[data-pane-scroll]")
          ? paneId
          : null;
      setActivePaneId(paneId);
      const key =
        e.type === "focusin" &&
        target instanceof HTMLElement &&
        target.matches(".node-text")
          ? target.dataset.historyKey
          : undefined;
      if (key) rememberPaneFocus(paneId, key);
    };
    window.addEventListener("pointerdown", follow, true);
    window.addEventListener("focusin", follow, true);
    return () => {
      window.removeEventListener("pointerdown", follow, true);
      window.removeEventListener("focusin", follow, true);
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return;
      if (!onWorkbenchKey(e)) return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  // A pane made active from the keyboard or a command (not by clicking into
  // it) gets the caret, so typing lands where the eye moved.
  useEffect(() => {
    if (previousPane.current === activePaneId) return;
    previousPane.current = activePaneId;
    const pressed = pressedContent.current === activePaneId;
    pressedContent.current = null;
    if (pressed) return;
    if (paneIdOf(document.activeElement) === activePaneId) return;
    if (document.querySelector('[role="dialog"]')) return;
    focusPaneEditor(activePaneId);
  }, [activePaneId]);

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

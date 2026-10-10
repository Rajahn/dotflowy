import {
  useCallback,
  useEffect,
  useRef,
  type PointerEvent as ReactPointerEvent,
} from "react";

import type { QueryFilter } from "../data/filter-query";
import type { ExternalDropTargetSpec, PluginContext } from "../plugins/types";

import { isMirrorsEnabled } from "../data/flags";
import { fileNote, libraryRow } from "../data/library";
import { getLiveNodes } from "../data/live-nodes";
import { scrollByY, scrollViewport, scrollerOf } from "../data/pane-scroll";
import { paneIdOf } from "../data/panes";
import { getSelectionDragSet } from "../data/selection-fill";
import {
  childrenOf,
  isNodeLocked,
  type Node,
  type TreeIndex,
} from "../data/tree";
import { virtualContentTop, virtualRowRect } from "../data/virtual-nav";
import {
  buildVisibleRows,
  instanceIdForKey,
  parentKeyOf,
} from "../data/visible-order";
import { activeTab } from "../workbench/model";
import { getWorkbenchState, openInPane, revealTab } from "../workbench/store";
import { getDragSurface, type DragSurface } from "./drag-surfaces";
import { commitDrop } from "./drop-commit";
import { INDENT_PX } from "./OutlineRow";

/**
 * Pointer-driven drag to reorder and reparent a bullet, for mouse and touch.
 * Drives the gesture imperatively (no React state on the hot path): on each
 * pointermove it measures the rendered rows, resolves the drop to a parent +
 * predecessor, and positions a floating pill and a drop indicator directly in
 * the DOM. The single `moveNode` call happens on release. See ADR 0010.
 *
 * The whole feature hangs off the bullet dot, which already zooms on click:
 * `startDrag` arms a movement threshold on pointerdown, and `consumeClick`
 * lets the dot's click handler tell a real drag apart from a plain click (only
 * the latter should zoom).
 *
 * Across the workbench (docs/workbench/PLAN.md 1.4, 2.6) the pointer may leave
 * the column the drag started in. Over another column's outline the drop is
 * projected on THAT column's rows (its `DragSurface`), by the same gap and
 * depth rules; holding Alt/Option copies instead of moving; resting on another
 * column's tab for half a second switches that column to it; a tab strip's
 * empty space opens the node in a new tab; a sidebar note or folder takes the
 * node in. Escape cancels. Every drop is one undo step.
 */

// Movement (px) before a press becomes a drag. Below this, it's a click → zoom.
const THRESHOLD = 5;
// Indent per depth level. The render's single source (OutlineRow.INDENT_PX);
// measured from the live rows when possible, this is the fallback so the
// windowed drop-depth projection can't drift from the rendered indent.
const INDENT_FALLBACK = INDENT_PX;
// How much of an indent the pointer must travel rightward before a drop nests
// one level deeper. 0 = snap to the nearest level (flips at the halfway point);
// higher = stickier toward the shallower level, so a near-vertical drag stays
// at sibling depth instead of slipping under the row above. 0.4 means you cross
// ~90% of an indent to nest. Tunable feel knob. See ADR 0010.
const NEST_RESISTANCE = 0.4;
// Distance from the scroller's edge (px) that triggers auto-scroll while dragging.
const EDGE = 72;
// Max auto-scroll speed (px per frame) at the very edge.
const SCROLL_MAX = 18;
// How long the pointer rests on a tab before its column switches to it.
const TAB_HOVER_MS = 500;

interface Row {
  // The render ADDRESS (row.key) -- the drag's identity, so a windowed source
  // descendant inside a mirror is the exact on-screen row, not its source copy
  // (ADR 0022). Equals `id` for every mirror-free row, so the 99% path is
  // unchanged. Geometry (virtualRowRect) and the refs lookup both key off this.
  key: string;
  // The INSTANCE (position) node id -- what `moveNode` repositions. Inside a
  // mirror's window this is the real node (instance === content), so reordering
  // it restructures the source and shows in every instance.
  id: string;
  // The CONTENT node id (`mirrorOf ?? id`). Used when this row is the drop
  // PARENT: dropping under a mirror targets its SOURCE, so the new child windows
  // into every instance (the ADR 0022 field split, applied in onMove).
  contentId: string;
  // The RENDER parent's instance id (`instanceIdForKey(parentKeyOf(key))`), not
  // the tree parent: inside a mirror a windowed child's render parent is the
  // mirror instance, so the sibling/ancestor projection stays within the window.
  // Field-split back to a content id in onMove. Equals the tree parent off-flag.
  parentId: string | null;
  depth: number; // relative to the zoom root: its direct children are depth 0
  el: HTMLElement | null;
}

// A row's viewport box for hit-testing, synthesized from the virtualizer's
// measurements (so an off-screen target still has geometry).
interface RowRect {
  top: number;
  bottom: number;
  height: number;
  left: number;
  right: number;
}

interface DragDeps {
  /** The workbench pane this editor renders in: the drag's own column. */
  paneId: string;
  getIndex: () => TreeIndex;
  getRootId: () => string | null;
  /** The composed Seam-G visibility prune (hide-completed today). Drag mirrors
   *  the render: a hidden node is not a droppable row. See ADR 0001. */
  getIsHidden: () => (node: Node) => boolean;
  /** The active `?q=` query filter (ADR 0047), or null. Read at event time (the
   *  editor supplies `getViewFilter`) so the drag's row model is exactly the
   *  filtered rows the editor renders: a row the filter pruned out of the DOM is
   *  not a drop target, and a match revealed inside a collapsed subtree IS one.
   *  See the ADR 0047 amendment and issue #244. */
  getFilter: () => QueryFilter | null;
  /** The `.outline-row` element for a row KEY (via the editor's refs registry,
   *  keyed by row.key since ADR 0022; key === id off the flag). */
  getRowEl: (key: string) => HTMLElement | null;
  /** The `ul.outline-list` element, for the indicator's right edge. */
  getListEl: () => HTMLElement | null;
  /** Plugin-owned controls that can receive this structural drag (Seam M). */
  getExternalDropTargets: () => readonly ExternalDropTargetSpec[];
  /** Live plugin context, resolved only when an external drop commits. */
  getPluginContext: () => PluginContext;
  /**
   * Commit an in-column move of the grabbed row alone. `grabbedKey` is the
   * dragged row's render address; the parent + predecessor are INSTANCE ids
   * from the render hierarchy. The editor resolves the field split (a drop
   * under a mirror targets its source) and re-derives the landing focus key
   * from the post-move render walk. Off the flag these are bare ids and the
   * resolution is a no-op. A copy, a multi-selection, or a drop in another
   * column goes through `commitDrop` instead.
   */
  onMove: (
    grabbedKey: string,
    newParentInstanceId: string | null,
    afterSiblingInstanceId: string | null,
  ) => void;
}

/** A core (non-plugin) drop target outside the outline gaps. */
type CoreTarget =
  | { kind: "tab"; paneId: string; tabId: string; element: HTMLElement }
  | { kind: "tabstrip"; paneId: string; element: HTMLElement }
  | { kind: "note"; nodeId: string; element: HTMLElement }
  | { kind: "folder"; folderId: string; element: HTMLElement };

interface DragState {
  /** The grabbed row's KEY (render address) -- buildRows/getRowEl/onMove all key
   *  off it. Equals the node id for every mirror-free drag. */
  id: string;
  /** Structural roots the drag carries. One instance id for an ordinary drag,
   *  or the active selection's ordered root run. */
  nodeIds: string[];
  /** Render rows dimmed while the drag is active. */
  sourceKeys: string[];
  startX: number;
  startY: number;
  dragging: boolean;
  /** Alt/Option held: the drop copies instead of moving. */
  copy: boolean;
  /** Each column's rows, built once per surface (a tab switch mid-drag
   *  publishes a new surface, which gets fresh rows). */
  rows: Map<DragSurface, Row[]>;
  indent: number;
  lastX: number;
  lastY: number;
  pending: {
    paneId: string;
    parentId: string | null;
    afterSiblingId: string | null;
  } | null;
  external: {
    spec: ExternalDropTargetSpec;
    element: HTMLElement;
  } | null;
  core: CoreTarget | null;
  /** The drop under the pointer would be refused (a locked parent, a cycle). */
  refused: boolean;
  hover: { tabId: string; timer: ReturnType<typeof setTimeout> } | null;
  indicator: HTMLElement | null;
  pill: HTMLElement | null;
  raf: number | null;
  // The exact listener instances registered for this drag, so cleanup removes
  // the same references even if the component re-rendered mid-drag.
  moveHandler: (e: PointerEvent) => void;
  upHandler: () => void;
  cancelHandler: () => void;
  keyHandler: (e: KeyboardEvent) => void;
}

/** Whether `id` is one of `roots` or sits inside one (by tree parents). */
function isWithinAny(
  index: TreeIndex,
  id: string,
  roots: ReadonlySet<string>,
): boolean {
  let cursor: string | null = id;
  let guard = index.byId.size + 1;
  while (cursor !== null && guard-- > 0) {
    if (roots.has(cursor)) return true;
    cursor = index.byId.get(cursor)?.parentId ?? null;
  }
  return false;
}

function markTarget(element: HTMLElement | null, on: boolean): void {
  if (on) element?.setAttribute("data-drop-active", "");
  else element?.removeAttribute("data-drop-active");
}

/** A core target under `hit`: a tab, a tab strip's empty space, a sidebar
 *  note (or unfiled node), or a sidebar folder. */
function coreTargetAt(hit: Element): CoreTarget | null {
  const tab = hit.closest<HTMLElement>("[data-tab-id]");
  const tabPane = paneIdOf(tab);
  if (tab && tabPane)
    return {
      kind: "tab",
      paneId: tabPane,
      tabId: tab.getAttribute("data-tab-id")!,
      element: tab,
    };
  const strip = hit.closest<HTMLElement>('[role="tablist"]');
  const stripPane = paneIdOf(strip);
  if (strip && stripPane)
    return { kind: "tabstrip", paneId: stripPane, element: strip };
  const libraryEl = hit.closest<HTMLElement>("[data-library-row]");
  if (libraryEl) {
    const row = libraryRow(libraryEl.getAttribute("data-library-row")!);
    if (row?.type === "folder")
      return { kind: "folder", folderId: row.id, element: libraryEl };
    if (row?.type === "note" && row.rootNodeId)
      return { kind: "note", nodeId: row.rootNodeId, element: libraryEl };
  }
  const unfiled = hit.closest<HTMLElement>("[data-library-node]");
  if (unfiled)
    return {
      kind: "note",
      nodeId: unfiled.getAttribute("data-library-node")!,
      element: unfiled,
    };
  return null;
}

export function useDragReorder(deps: DragDeps) {
  const depsRef = useRef(deps);
  depsRef.current = deps;

  const state = useRef<DragState | null>(null);
  // Set on a real drag so the dot's click (which follows pointerup) skips zoom.
  const consumed = useRef(false);

  const cleanup = useCallback(() => {
    const s = state.current;
    if (!s) return;
    if (s.raf != null) cancelAnimationFrame(s.raf);
    if (s.hover) clearTimeout(s.hover.timer);
    s.external?.element.removeAttribute("data-external-drop-active");
    markTarget(s.core?.element ?? null, false);
    s.indicator?.remove();
    s.pill?.remove();
    for (const key of s.sourceKeys) {
      depsRef.current.getRowEl(key)?.classList.remove("drag-source");
    }
    document.body.classList.remove("dragging-active", "drag-refused");
    document.removeEventListener("pointermove", s.moveHandler);
    document.removeEventListener("pointerup", s.upHandler);
    document.removeEventListener("pointercancel", s.cancelHandler);
    window.removeEventListener("keydown", s.keyHandler, true);
    window.removeEventListener("keyup", s.keyHandler, true);
    state.current = null;
  }, []);

  /** The surface for `paneId`: a published one, or -- for this editor's own
   *  column before it published -- one made from the hook's deps. */
  const surfaceFor = useCallback((paneId: string): DragSurface | null => {
    const published = getDragSurface(paneId);
    if (published) return published;
    const d = depsRef.current;
    if (paneId !== d.paneId) return null;
    return {
      paneId,
      getRootId: d.getRootId,
      getIsHidden: d.getIsHidden,
      getFilter: d.getFilter,
      getRowEl: d.getRowEl,
      getListEl: d.getListEl,
      land: () => {},
    };
  }, []);

  // Build the visible, ordered rows (matching what's rendered), with depth,
  // excluding the grabbed row and everything under it (can't drop into self).
  //
  // Reuses `buildVisibleRows` -- the SAME flat walk the editor renders and the
  // virtualizer indexes -- so the drag's rows can't drift from what's on screen
  // (inside a mirror the ad-hoc tree walk produced the wrong rows: it never
  // resolved the windowed source descendants, so their geometry was missing and
  // the drop line projected off only the non-mirror rows). In the drag's own
  // column the grabbed subtree is the CONTIGUOUS run of deeper rows right after
  // the grabbed one -- the flat list's standard subtree property, uniform
  // across mirror-free and crossed paths. In another column the carried roots
  // and their descendants are excluded by tree ancestry (that column may show
  // them anywhere, or not at all). The active `?q=` filter is threaded through
  // (issue #244 / the ADR 0047 amendment): the drag's rows are exactly the
  // filtered rows the render shows, so a filtered-out row is never a drop
  // target and a match revealed inside a collapsed subtree is. A drop in a gap
  // whose real siblings are hidden lands after the visible predecessor (the
  // projection already computes that once the model is filtered); a node that
  // lands hidden is disclosed by the editor's onMove (the "vanish" toast).
  const buildRows = useCallback(
    (surface: DragSurface, grabbedKey: string, carried: string[]): Row[] => {
      const index = depsRef.current.getIndex();
      const visible = buildVisibleRows(
        index,
        surface.getRootId(),
        surface.getIsHidden(),
        surface.getFilter(),
        isMirrorsEnabled(),
      );
      const own = surface.paneId === depsRef.current.paneId;
      const carriedSet = new Set(carried);

      // The grabbed row, then skip it + its rendered subtree (rows deeper than
      // it, up to the next row at or above its depth).
      const gi = own ? visible.findIndex((r) => r.key === grabbedKey) : -1;
      let skipEnd = gi;
      if (gi !== -1) {
        const grabbedDepth = visible[gi]!.depth;
        skipEnd = gi + 1;
        while (
          skipEnd < visible.length &&
          visible[skipEnd]!.depth > grabbedDepth
        ) {
          skipEnd++;
        }
      }

      const rows: Row[] = [];
      for (let i = 0; i < visible.length; i++) {
        if (gi !== -1 && i >= gi && i < skipEnd) continue;
        const vr = visible[i]!;
        if (!own && isWithinAny(index, vr.id, carriedSet)) continue;
        const parentKey = parentKeyOf(vr.key);
        rows.push({
          key: vr.key,
          id: vr.id,
          contentId: vr.contentId,
          // Render parent: the mirror/ancestor instance the row sits under, or
          // the node's tree parent at the top level (key === id, parentKey ===
          // null).
          parentId: parentKey
            ? instanceIdForKey(parentKey)
            : (index.byId.get(vr.id)?.parentId ?? null),
          depth: vr.depth,
          el: surface.getRowEl(vr.key),
        });
      }
      return rows;
    },
    [],
  );

  const rowsFor = useCallback(
    (surface: DragSurface): Row[] => {
      const s = state.current;
      if (!s) return [];
      let rows = s.rows.get(surface);
      if (!rows) {
        rows = buildRows(surface, s.id, s.nodeIds);
        s.rows.set(surface, rows);
      }
      return rows;
    },
    [buildRows],
  );

  const updatePill = useCallback(() => {
    const s = state.current;
    if (!s?.pill) return;
    if (s.copy) s.pill.setAttribute("data-copy", "");
    else s.pill.removeAttribute("data-copy");
  }, []);

  const beginDrag = useCallback(() => {
    const s = state.current;
    if (!s) return;
    s.dragging = true;
    const own = surfaceFor(depsRef.current.paneId);
    const rows = own ? rowsFor(own) : [];

    // Derive the per-level indent from two rows at different depths; fall back
    // to the CSS constant when the list is too shallow to measure.
    s.indent = INDENT_FALLBACK;
    const a = rows.find((r) => r.el);
    const b = rows.find((r) => r.el && r.depth !== a?.depth);
    if (a?.el && b?.el && a.depth !== b.depth) {
      const la = a.el.getBoundingClientRect().left;
      const lb = b.el.getBoundingClientRect().left;
      s.indent = Math.abs((la - lb) / (a.depth - b.depth)) || INDENT_FALLBACK;
    }

    for (const key of s.sourceKeys) {
      depsRef.current.getRowEl(key)?.classList.add("drag-source");
    }

    const index = depsRef.current.getIndex();
    let text =
      index.byId.get(instanceIdForKey(s.id))?.text?.trim() || "Untitled";
    if (s.nodeIds.length > 1) text += ` +${s.nodeIds.length - 1}`;

    const pill = document.createElement("div");
    pill.className = "drag-pill";
    pill.textContent = text;
    document.body.appendChild(pill);
    s.pill = pill;
    updatePill();

    const indicator = document.createElement("div");
    indicator.className = "drag-indicator";
    document.body.appendChild(indicator);
    s.indicator = indicator;

    document.body.classList.add("dragging-active");
  }, [surfaceFor, rowsFor, updatePill]);

  /** Point the drag at a core target (or none), managing the hover timer: a
   *  rest on ANOTHER column's tab switches that column to it. The drag's own
   *  column never switches mid-drag -- its editor, and this drag, would
   *  remount. */
  const setCore = useCallback((next: CoreTarget | null) => {
    const s = state.current;
    if (!s) return;
    if (s.core?.element !== next?.element) {
      markTarget(s.core?.element ?? null, false);
      markTarget(next?.element ?? null, true);
    }
    s.core = next;
    const hoverTab =
      next?.kind === "tab" && next.paneId !== depsRef.current.paneId
        ? next
        : null;
    if (s.hover && s.hover.tabId !== hoverTab?.tabId) {
      clearTimeout(s.hover.timer);
      s.hover = null;
    }
    if (hoverTab && !s.hover) {
      s.hover = {
        tabId: hoverTab.tabId,
        timer: setTimeout(
          () => revealTab(hoverTab.paneId, hoverTab.tabId),
          TAB_HOVER_MS,
        ),
      };
    }
  }, []);

  // Resolve the pointer position to a drop gap + target depth, position the
  // indicator and pill, and stash the pending (pane, parent, predecessor).
  const project = useCallback(
    (px: number, py: number) => {
      const s = state.current;
      if (!s) return;
      if (s.pill) {
        s.pill.style.left = `${px + 12}px`;
        s.pill.style.top = `${py + 12}px`;
      }
      const setRefused = (refused: boolean) => {
        s.refused = refused;
        document.body.classList.toggle("drag-refused", refused);
      };
      const hideIndicator = () => {
        s.pending = null;
        if (s.indicator) s.indicator.style.display = "none";
      };

      // External plugin target wins over ordinary outline-gap projection. The
      // floating drag pill is pointer-events:none, so elementFromPoint sees the
      // actual rendered control beneath the pointer/finger center (ADR 0054).
      const hit = document.elementFromPoint(px, py);
      let external: DragState["external"] = null;
      if (hit instanceof Element) {
        for (const spec of depsRef.current.getExternalDropTargets()) {
          const match = hit.closest(spec.selector);
          const element = match instanceof HTMLElement ? match : null;
          if (element && (!spec.accepts || spec.accepts(element, s.nodeIds))) {
            external = { spec, element };
            break;
          }
        }
      }
      if (external) {
        if (
          s.external?.spec !== external.spec ||
          s.external.element !== external.element
        ) {
          s.external?.element.removeAttribute("data-external-drop-active");
          external.element.setAttribute("data-external-drop-active", "");
          s.external = external;
        }
        setCore(null);
        setRefused(false);
        hideIndicator();
        return;
      }
      s.external?.element.removeAttribute("data-external-drop-active");
      s.external = null;

      // Core targets outside the outline: tabs, tab strips, the sidebar.
      const core = hit instanceof Element ? coreTargetAt(hit) : null;
      setCore(core);
      if (core) {
        s.pending = null;
        hideIndicator();
        const index = depsRef.current.getIndex();
        setRefused(
          core.kind === "note" &&
            (isWithinAny(index, core.nodeId, new Set(s.nodeIds)) ||
              isNodeLocked(index, core.nodeId)),
        );
        return;
      }

      // The column under the pointer. Off every column (a gutter, a resize
      // handle, outside the window) the drag's own column takes it, as before
      // there were columns -- except over the workbench chrome.
      const overChrome =
        hit instanceof Element &&
        hit.closest(".workbench-sidebar, [role='tablist']") !== null;
      const paneId =
        (hit instanceof Element ? paneIdOf(hit) : null) ??
        (overChrome ? null : depsRef.current.paneId);
      const surface = paneId ? surfaceFor(paneId) : null;
      if (!paneId || !surface) {
        s.pending = null;
        setRefused(false);
        hideIndicator();
        return;
      }
      if (s.indicator) s.indicator.style.display = "";

      // Geometry source: the virtualizer's measurements (via the nav bridge the
      // editor wires on mount), so an off-screen drop target still has a
      // position, estimated until it renders.
      const listEl = surface.getListEl();
      const listRect = listEl?.getBoundingClientRect();
      // The scroller's offset, read once per projection rather than per row.
      const contentTop = virtualContentTop(paneId) ?? undefined;
      const pairs: { row: Row; rect: RowRect }[] = [];
      for (const r of rowsFor(surface)) {
        const vr = virtualRowRect(r.key, paneId, contentTop);
        if (!vr) continue;
        // Uniform indent: depth-0 left is the container left; deeper rows add
        // depth * indent (OutlineRow's paddingInlineStart). project() backs
        // baseLeft out of this exactly, so the synthesized left is
        // self-consistent.
        const left = (listRect?.left ?? 0) + r.depth * s.indent;
        pairs.push({
          row: r,
          rect: {
            top: vr.top,
            bottom: vr.top + vr.height,
            height: vr.height,
            left,
            right: listRect?.right ?? left + 240,
          },
        });
      }
      const rows = pairs.map((p) => p.row);
      const rects = pairs.map((p) => p.rect);

      // Gap: index of the first row whose vertical midpoint is below the pointer.
      let gap = rows.length;
      for (let i = 0; i < rows.length; i++) {
        if (py < rects[i]!.top + rects[i]!.height / 2) {
          gap = i;
          break;
        }
      }
      const above = gap > 0 ? rows[gap - 1]! : null;
      const aboveRect = gap > 0 ? rects[gap - 1]! : null;
      const below = gap < rows.length ? rows[gap]! : null;
      const belowRect = gap < rows.length ? rects[gap]! : null;

      // Legal depth range at this gap: as deep as a child of the row above, as
      // shallow as the row below (or top-level). 0 = direct child of the zoom
      // root, so the lower bound also keeps the node inside the current view.
      const maxDepth = above ? above.depth + 1 : 0;
      const minDepth = below ? below.depth : 0;

      // Base x of depth 0, backed out from a known row, then depth from pointer
      // x. An empty column has no row: its list's left edge is depth 0.
      const ref = above ?? below;
      const refRect = aboveRect ?? belowRect;
      const baseLeft =
        ref && refRect
          ? refRect.left - ref.depth * s.indent
          : (listRect?.left ?? 0);
      // Subtract NEST_RESISTANCE so gaining depth needs deliberate rightward
      // travel; shedding depth (moving left) stays easy.
      const desired = Math.round((px - baseLeft) / s.indent - NEST_RESISTANCE);
      const depth = Math.max(minDepth, Math.min(maxDepth, desired));

      // Parent + predecessor for `depth` at this gap.
      const rootId = surface.getRootId();
      let parentId: string | null;
      if (depth === 0 || !above) {
        parentId = rootId;
      } else if (depth === above.depth + 1) {
        parentId = above.id; // become the row above's (last/only) child
      } else if (depth === above.depth) {
        parentId = above.parentId; // sibling of the row above
      } else {
        // Shallower than the row above: adopt the nearest ancestor at this depth.
        let found: string | null = rootId;
        for (let i = gap - 1; i >= 0; i--) {
          if (rows[i]!.depth === depth) {
            found = rows[i]!.parentId;
            break;
          }
          if (rows[i]!.depth < depth) break;
        }
        parentId = found;
      }

      // Predecessor: nearest row above the gap at exactly `depth` under
      // `parentId`. Stop if we drop below `depth` first — then we're the first
      // child (null).
      let afterSiblingId: string | null = null;
      for (let i = gap - 1; i >= 0; i--) {
        if (rows[i]!.depth < depth) break;
        if (rows[i]!.depth === depth && rows[i]!.parentId === parentId) {
          afterSiblingId = rows[i]!.id;
          break;
        }
      }

      s.pending = { paneId, parentId, afterSiblingId };
      // A locked parent, or a drop into a carried node's own subtree (another
      // column may show the carried roots as its zoom root), is refused.
      // Tested on the CONTENT parent: a drop under a mirror lands in its
      // source (ADR 0022), which may be a carried node.
      const index = depsRef.current.getIndex();
      const contentParent =
        isMirrorsEnabled() && parentId !== null
          ? (index.byId.get(parentId)?.mirrorOf ?? parentId)
          : parentId;
      setRefused(
        contentParent !== null &&
          (isNodeLocked(index, contentParent) ||
            isWithinAny(index, contentParent, new Set(s.nodeIds))),
      );

      // Indicator: a line at the gap, indented to the target depth.
      const y = aboveRect
        ? aboveRect.bottom
        : belowRect
          ? belowRect.top
          : (listRect?.top ?? py);
      const left = baseLeft + depth * s.indent;
      const right = listRect?.right ?? left + 240;
      if (s.indicator) {
        s.indicator.style.top = `${y}px`;
        s.indicator.style.left = `${left}px`;
        s.indicator.style.width = `${Math.max(40, right - left)}px`;
      }
    },
    [rowsFor, surfaceFor, setCore],
  );

  // Auto-scroll loop: while the pointer sits in a top/bottom edge band of the
  // scroller under it (a column's pane root on a wide screen, the window on a
  // narrow one -- pane-scroll.ts), scroll it and re-project so off-screen drop
  // targets become reachable.
  const tickScroll = useCallback(() => {
    const s = state.current;
    if (!s || !s.dragging) return;
    // Only a column under the pointer scrolls: over a tab, a tab strip or
    // the sidebar nothing does.
    if (!s.pending) {
      s.raf = requestAnimationFrame(tickScroll);
      return;
    }
    const scroller = scrollerOf(
      surfaceFor(s.pending.paneId)?.getListEl() ?? depsRef.current.getListEl(),
    );
    const view = scrollViewport(scroller);
    const y = s.lastY - view.top;
    const h = view.height;
    let dy = 0;
    if (y < EDGE) dy = -SCROLL_MAX * (1 - Math.max(0, y) / EDGE);
    else if (y > h - EDGE) dy = SCROLL_MAX * (1 - Math.max(0, h - y) / EDGE);
    if (dy !== 0) {
      scrollByY(scroller, dy);
      project(s.lastX, s.lastY);
    }
    s.raf = requestAnimationFrame(tickScroll);
  }, [project, surfaceFor]);

  function onMove(e: PointerEvent) {
    const s = state.current;
    if (!s) return;
    s.lastX = e.clientX;
    s.lastY = e.clientY;
    if (s.copy !== e.altKey) {
      s.copy = e.altKey;
      updatePill();
    }
    if (!s.dragging) {
      const moved = Math.hypot(e.clientX - s.startX, e.clientY - s.startY);
      if (moved < THRESHOLD) return;
      beginDrag();
      s.raf = requestAnimationFrame(tickScroll);
    }
    e.preventDefault();
    project(e.clientX, e.clientY);
  }

  function onUp() {
    const s = state.current;
    if (!s) return;
    if (!s.dragging) {
      cleanup();
      return;
    }
    consumed.current = true;
    const { pending, external, core, nodeIds, copy, refused } = s;
    const grabbedKey = s.id;
    const ownPane = depsRef.current.paneId;
    cleanup();
    if (external) {
      external.spec.onDrop(
        external.element,
        nodeIds,
        depsRef.current.getPluginContext(),
      );
      return;
    }
    if (refused) return;
    if (core) {
      dropOnCore(core, nodeIds, copy);
      return;
    }
    if (!pending) return;
    if (pending.paneId === ownPane && !copy && nodeIds.length === 1) {
      depsRef.current.onMove(
        grabbedKey,
        pending.parentId,
        pending.afterSiblingId,
      );
      return;
    }
    // Recorded in the TARGET column's tab: the write pins it, and undo
    // returns there.
    const target = surfaceFor(pending.paneId);
    const tab = activeTab(getWorkbenchState(), pending.paneId);
    const landed = commitDrop({
      nodeIds,
      parentInstanceId: pending.parentId,
      afterId: pending.afterSiblingId,
      copy,
      location: {
        rootId: target?.getRootId() ?? null,
        paneId: pending.paneId,
        tabId: tab?.id,
        rowKey: null,
        caret: null,
        selection: null,
      },
    });
    if (landed[0]) getDragSurface(pending.paneId)?.land(landed[0]);
  }

  /** Commit a drop on a core target. */
  function dropOnCore(core: CoreTarget, nodeIds: string[], copy: boolean) {
    const index = depsRef.current.getIndex();
    switch (core.kind) {
      case "tab":
        // Released on a tab itself: the drag just ends (a rest switches it).
        return;
      case "tabstrip":
        // Open the node in a new tab there; nothing moves.
        openInPane(core.paneId, nodeIds[0]!, { preview: false });
        return;
      case "note": {
        // The last child of the note's root (its source, when the root is a
        // mirror: that is where commitDrop puts it).
        const parent = isMirrorsEnabled()
          ? (index.byId.get(core.nodeId)?.mirrorOf ?? core.nodeId)
          : core.nodeId;
        const last = childrenOf(index, parent).at(-1)?.id ?? null;
        commitDrop({
          nodeIds,
          parentInstanceId: core.nodeId,
          afterId: last,
          copy,
        });
        return;
      }
      case "folder": {
        // New top-level node(s), filed as notes in the folder.
        const top = childrenOf(index, null).filter(
          (n) => copy || !nodeIds.includes(n.id),
        );
        const landed = commitDrop({
          nodeIds,
          parentInstanceId: null,
          afterId: top.at(-1)?.id ?? null,
          copy,
        });
        // A copy files its copies; a move files every carried root now at
        // the top level, including one that was already last there (a no-op
        // move commitDrop doesn't report).
        const live = new Map(getLiveNodes().map((n) => [n.id, n]));
        const roots = copy
          ? landed
          : nodeIds.filter((id) => live.get(id)?.parentId === null);
        for (const id of roots) fileNote(id, core.folderId);
        return;
      }
    }
  }

  function onCancel() {
    const s = state.current;
    if (!s) return;
    if (s.dragging) consumed.current = true;
    cleanup();
  }

  // Escape cancels a live drag; Alt/Option flips copy without a pointer move.
  function onKey(e: KeyboardEvent) {
    const s = state.current;
    if (!s) return;
    if (e.type === "keydown" && e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onCancel();
      return;
    }
    if (e.key === "Alt" && s.copy !== (e.type === "keydown")) {
      s.copy = e.type === "keydown";
      updatePill();
    }
  }

  const startDrag = useCallback(
    (grabbedKey: string, e: ReactPointerEvent) => {
      // A fresh press: clear any stale click-suppression.
      consumed.current = false;
      // Ignore secondary buttons.
      if (e.button !== 0 && e.pointerType === "mouse") return;
      // Snapshot selection ownership at press time, before any compatibility
      // mouse/focus events can run. Pointer cancel and failed async drops leave
      // the actor itself untouched; this snapshot only drives the gesture.
      const selected = getSelectionDragSet(depsRef.current.paneId, grabbedKey);
      state.current = {
        id: grabbedKey,
        nodeIds: selected?.rootIds ?? [instanceIdForKey(grabbedKey)],
        sourceKeys: selected?.rowKeys ?? [grabbedKey],
        startX: e.clientX,
        startY: e.clientY,
        dragging: false,
        copy: e.altKey,
        rows: new Map(),
        indent: INDENT_FALLBACK,
        lastX: e.clientX,
        lastY: e.clientY,
        pending: null,
        external: null,
        core: null,
        refused: false,
        hover: null,
        indicator: null,
        pill: null,
        raf: null,
        moveHandler: onMove,
        upHandler: onUp,
        cancelHandler: onCancel,
        keyHandler: onKey,
      };
      document.addEventListener("pointermove", onMove, { passive: false });
      document.addEventListener("pointerup", onUp);
      document.addEventListener("pointercancel", onCancel);
      window.addEventListener("keydown", onKey, true);
      window.addEventListener("keyup", onKey, true);
    },
    // startDrag must stay referentially stable (it rides in the memoized
    // commands, ADR 0014). onMove/onUp are recreated each render but read only
    // refs (state.current, depsRef.current), so the mount-render closures behave
    // identically; cleanup removes the exact stored references. Adding them
    // would churn startDrag for zero correctness gain.
    // eslint-disable-next-line react-doctor/exhaustive-deps
    [],
  );

  // True when the click that follows pointerup came from a real drag and should
  // be swallowed (no zoom). Resets itself so the next genuine click zooms.
  const consumeClick = useCallback(() => {
    if (consumed.current) {
      consumed.current = false;
      return true;
    }
    return false;
  }, []);

  // Unmount teardown. `cleanup` is otherwise only reached via `onUp`
  // (pointerup/cancel); if this component unmounts mid-drag (the windowed source
  // row scrolls out, a zoom/route change, a big sync re-render), the document
  // pointer listeners + rAF loop + injected pill/indicator + `dragging-active`
  // body class would all leak. An empty-dep effect whose cleanup runs only on
  // unmount removes exactly that. cleanup() self-guards on a null drag, so this
  // is a no-op when nothing is in flight. cleanup is stable ([] deps).
  useEffect(() => cleanup, [cleanup]);

  return { startDrag, consumeClick };
}

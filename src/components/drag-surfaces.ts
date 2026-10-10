import type { QueryFilter } from "../data/filter-query";
import type { Node } from "../data/tree";

/**
 * What a bullet drag needs from each workbench pane it may land in
 * (docs/workbench/PLAN.md 2.6). The drag itself lives in the editor it started
 * in (use-drag-reorder.ts), but the pointer can cross into any column: there
 * the drop gap and depth come from THAT pane's rows, view state and virtual
 * geometry, by the same rules as an in-pane drag. Each editor publishes its
 * surface on mount.
 */
export interface DragSurface {
  paneId: string;
  getRootId: () => string | null;
  getIsHidden: () => (node: Node) => boolean;
  getFilter: () => QueryFilter | null;
  /** The `.outline-row` element for a row key. */
  getRowEl: (key: string) => HTMLElement | null;
  /** The `ul.outline-list` element. */
  getListEl: () => HTMLElement | null;
  /** Focus and flash a node after a drop landed in this pane. */
  land: (nodeId: string) => void;
}

const surfaces = new Map<string, DragSurface>();

/** Publish a pane's surface. The unpublish only clears it if still current. */
export function registerDragSurface(surface: DragSurface): () => void {
  surfaces.set(surface.paneId, surface);
  return () => {
    if (surfaces.get(surface.paneId) === surface)
      surfaces.delete(surface.paneId);
  };
}

export function getDragSurface(paneId: string): DragSurface | undefined {
  return surfaces.get(paneId);
}

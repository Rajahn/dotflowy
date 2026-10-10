import { toast } from "sonner";

import { getDragSurface } from "../components/drag-surfaces";
import { commitDrop } from "../components/drop-commit";
import { getNodeActionBridge } from "../data/command-bridge";
import { focusKeyFor } from "../data/focus-key";
import {
  getActivePaneId,
  getPaneFocus,
  rememberPaneFocus,
} from "../data/panes";
import { getPaneRows } from "../data/selection-fill";
import { clearSelection, getSelectionRootIds } from "../data/selection-state";
import { getTreeIndex } from "../data/tree-store";
import { getViewRootIdFor } from "../data/view-state";
import { columnMoveLanding, columnMoveSlot } from "./column-move";
import { activeTab } from "./model";
import { getWorkbenchState, pinTabById } from "./store";

/**
 * Ctrl+Alt+←/→ (docs/workbench/PLAN.md 1.5): move the selection -- or, with no
 * selection, the row with the caret -- into the active tab of the column to the
 * left or right, right after the row that column last had the caret in. The
 * caret stays in the source column, on the row that followed the moved block.
 * One history capture, so one undo puts everything back in the source column.
 * Returns false when there is nothing to move or no column on that side.
 *
 * `rowKey` names the row to move when there is no selection; by default it is
 * the row with the caret. Cmd+K passes the row it snapshotted when it opened,
 * since the dialog holds focus when the action runs.
 */
export function moveToAdjacentColumn(
  delta: -1 | 1,
  rowKey: string | null = getNodeActionBridge()?.findFocusedId() ?? null,
): boolean {
  const state = getWorkbenchState();
  const sourcePane = getActivePaneId();
  const i = state.panes.findIndex((p) => p.id === sourcePane);
  const target = i < 0 ? undefined : state.panes[i + delta];
  if (!target) return false;
  const targetTab = activeTab(state, target.id);
  if (!targetTab) {
    toast("That column has no open tab.");
    return true;
  }

  const rows = getPaneRows(sourcePane);
  // The selection is page-wide: it moves only when it is in this column.
  const shown = new Set(rows.map((r) => r.id));
  const selected = getSelectionRootIds().filter((id) => shown.has(id));
  let nodeIds: string[];
  if (selected.length > 0) {
    nodeIds = selected;
  } else {
    const row = rowKey ? rows.find((r) => r.key === rowKey) : undefined;
    if (!row) return false;
    nodeIds = [row.id];
  }

  const index = getTreeIndex();
  const moved = new Set(nodeIds);
  const targetRoot = getViewRootIdFor(target.id);
  const slot = columnMoveSlot(
    index,
    targetRoot,
    getPaneFocus(target.id),
    moved,
  );
  // A single node already in that slot (both columns show the same note):
  // nothing to do, and nothing was refused.
  const only = nodeIds.length === 1 ? index.byId.get(nodeIds[0]!) : undefined;
  if (
    only &&
    only.parentId === slot.parentId &&
    only.prevSiblingId === slot.afterId
  )
    return true;
  // Read before the move: afterwards the moved rows are gone from the source.
  const sourceRoot = getViewRootIdFor(sourcePane);
  const landing = columnMoveLanding(rows, index, moved, sourceRoot);

  const landed = commitDrop({
    nodeIds,
    parentInstanceId: slot.parentId,
    afterId: slot.afterId,
    copy: false,
  });
  if (landed.length === 0) {
    toast("Can't move there.");
    return true;
  }
  clearSelection();
  pinTabById(targetTab.id);
  // The next move into that column lands after these.
  const last = landed.at(-1)!;
  rememberPaneFocus(target.id, focusKeyFor(last, last, target.id));
  getDragSurface(target.id)?.flash(landed[0]!);
  if (landing !== null && landing !== sourceRoot)
    getNodeActionBridge(sourcePane)?.focusNode(landing);
  else focusTitle(sourcePane);
  return true;
}

/** Put the caret in a column's zoom title (the moved block was all it showed). */
function focusTitle(paneId: string): void {
  requestAnimationFrame(() => {
    const title = document.querySelector<HTMLElement>(
      `[data-pane-id="${CSS.escape(paneId)}"] .zoomed-title-text`,
    );
    title?.focus({ preventScroll: true });
  });
}

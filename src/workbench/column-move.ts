import type { VisibleRow } from "../data/visible-order";

import { childrenOf, type TreeIndex } from "../data/tree";

/**
 * Where Ctrl+Alt+←/→ puts nodes, and where the caret goes after
 * (docs/workbench/PLAN.md 1.5). Pure, so both rules are unit-tested; the
 * workbench host applies them (column-move-action.ts).
 */

/** Whether `id` is `ancestorId` or sits inside it (null = the whole outline). */
function isWithin(
  index: TreeIndex,
  id: string,
  ancestorId: string | null,
): boolean {
  if (ancestorId === null) return index.byId.has(id);
  let cursor: string | null = id;
  let guard = index.byId.size + 1;
  while (cursor !== null && guard-- > 0) {
    if (cursor === ancestorId) return true;
    cursor = index.byId.get(cursor)?.parentId ?? null;
  }
  return false;
}

/** A sibling slot: under `parentId`, right after `afterId` (null = first). */
export interface ColumnSlot {
  parentId: string | null;
  afterId: string | null;
}

/**
 * The slot in the target column: right after the node it last had the caret
 * in, as that node's next sibling -- provided that node is still inside the
 * column's zoom root, isn't the root itself (its siblings are outside the
 * view), and isn't one of the moved nodes or inside them. Otherwise the end
 * of the zoom root.
 */
export function columnMoveSlot(
  index: TreeIndex,
  targetRootId: string | null,
  lastFocusedId: string | null,
  moved: ReadonlySet<string>,
): ColumnSlot {
  const anchor = lastFocusedId ? index.byId.get(lastFocusedId) : undefined;
  if (
    anchor &&
    anchor.id !== targetRootId &&
    isWithin(index, anchor.id, targetRootId) &&
    ![...moved].some((id) => isWithin(index, anchor.id, id))
  ) {
    return { parentId: anchor.parentId, afterId: anchor.id };
  }
  const kids = childrenOf(index, targetRootId).filter((n) => !moved.has(n.id));
  return { parentId: targetRootId, afterId: kids.at(-1)?.id ?? null };
}

/**
 * Where the caret lands in the source column once `moved` leave it: the first
 * row after the moved block, else the last row before it, else the moved
 * nodes' parent (null when that's the view's own root or the top level --
 * the caller then focuses nothing new).
 */
export function columnMoveLanding(
  rows: readonly VisibleRow[],
  index: TreeIndex,
  moved: ReadonlySet<string>,
  rootId: string | null,
): string | null {
  const inside = (row: VisibleRow) =>
    [...moved].some((id) => isWithin(index, row.id, id));
  const first = rows.findIndex(inside);
  if (first < 0) return null;
  let last = first;
  for (let i = first; i < rows.length; i++) if (inside(rows[i]!)) last = i;
  const after = rows.slice(last + 1).find((r) => !inside(r));
  if (after) return after.key;
  const before = rows
    .slice(0, first)
    .reverse()
    .find((r) => !inside(r));
  if (before) return before.key;
  const parent = index.byId.get(rows[first]!.id)?.parentId ?? null;
  return parent !== null ? parent : rootId;
}

import {
  childrenOf,
  isNodeLocked,
  trueSourceOf,
  type TreeIndex,
} from "../data/tree";
import { parseRowKey, type VisibleRow } from "../data/visible-order";

/**
 * Where Ctrl+Alt+←/→ puts nodes, and where the caret goes after
 * (docs/workbench/PLAN.md 1.5). Pure, so both rules are unit-tested; the
 * workbench host applies them (column-move-action.ts).
 */

/** Whether `id` is in `set` or sits inside one of them. */
function isWithinAny(
  index: TreeIndex,
  id: string,
  set: ReadonlySet<string | null>,
): boolean {
  let cursor: string | null = id;
  let guard = index.byId.size + 1;
  while (cursor !== null && guard-- > 0) {
    if (set.has(cursor)) return true;
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
 * The slot in the target column: right after the row it last had the caret
 * in, as that row's next sibling -- provided the row (a render key: a path
 * through any mirrors on the way) is still inside the column's zoom root,
 * isn't the root itself (its siblings are outside the view), isn't one of
 * the moved nodes or inside them, and its parent takes children (not
 * locked). Otherwise the end of the zoom root (its source's children, when
 * the root is a mirror).
 */
export function columnMoveSlot(
  index: TreeIndex,
  targetRootId: string | null,
  lastFocusedKey: string | null,
  moved: ReadonlySet<string>,
): ColumnSlot {
  const path = lastFocusedKey ? parseRowKey(lastFocusedKey) : [];
  const anchor = index.byId.get(path.at(-1) ?? "");
  const inView =
    path.length > 0 &&
    (targetRootId === null
      ? index.byId.has(path[0]!)
      : isWithinAny(index, path[0]!, new Set([targetRootId])));
  if (
    anchor &&
    inView &&
    anchor.id !== targetRootId &&
    !path.some((id) => isWithinAny(index, id, moved)) &&
    !(anchor.parentId !== null && isNodeLocked(index, anchor.parentId))
  ) {
    return { parentId: anchor.parentId, afterId: anchor.id };
  }
  const content =
    targetRootId === null ? null : trueSourceOf(index, targetRootId);
  const kids = childrenOf(index, content).filter((n) => !moved.has(n.id));
  return { parentId: targetRootId, afterId: kids.at(-1)?.id ?? null };
}

/**
 * Where the caret lands in the source column once `moved` leave it: the first
 * row after the moved block, else the last row before it, else the moved
 * nodes' parent (null when that's the view's own root or the top level --
 * the caller then focuses nothing new). A row is in the block when any node
 * on its render path is a moved node or inside one (a moved mirror takes its
 * expanded source rows with it).
 */
export function columnMoveLanding(
  rows: readonly VisibleRow[],
  index: TreeIndex,
  moved: ReadonlySet<string>,
  rootId: string | null,
): string | null {
  const inside = (row: VisibleRow) =>
    parseRowKey(row.key).some((id) => isWithinAny(index, id, moved));
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

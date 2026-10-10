import { childrenOf, type Node, type TreeIndex } from "./tree";

/**
 * Deep copy of whole subtrees (docs/workbench/PLAN.md 2.7), planned purely so
 * the id remapping and sibling chains are unit-tested; `copySubtrees` in
 * `mutations.ts` applies the plan as one atomic structural batch (ADR 0009).
 *
 * What a copy keeps: text, kind, task-ness, completion, collapse, and
 * `mirrorOf` (a copied mirror is another mirror of the same source). What it
 * drops: the owner lock, the bookmark, and provenance (`origin`) -- the copy is
 * a fresh node the user made. Node links in the text keep pointing at their
 * original targets.
 */
export interface SubtreeCopyPlan {
  /** Every new node, parents before children, ready to insert. */
  nodes: Node[];
  /** The new ids of the copied roots, in order. */
  rootIds: string[];
  /** The node that followed the drop slot and must now follow the last copied
   *  root, or null when the copies land at the end. */
  follower: string | null;
}

/**
 * Plan copies of `ids` (each with its whole subtree) under `parentId`, after
 * `afterId` (null = first). Ids inside another copied root's subtree are
 * skipped (they come along with it). `makeId` mints new ids; `at` stamps
 * createdAt/updatedAt.
 */
export function planSubtreeCopy(
  index: TreeIndex,
  ids: readonly string[],
  parentId: string | null,
  afterId: string | null,
  makeId: () => string,
  at: number,
): SubtreeCopyPlan {
  const selected = new Set(ids);
  const isInsideSelected = (id: string): boolean => {
    let cursor = index.byId.get(id)?.parentId ?? null;
    let guard = index.byId.size + 1;
    while (cursor !== null && guard-- > 0) {
      if (selected.has(cursor)) return true;
      cursor = index.byId.get(cursor)?.parentId ?? null;
    }
    return false;
  };
  const roots = ids.filter((id) => index.byId.has(id) && !isInsideSelected(id));

  const nodes: Node[] = [];
  const copyOne = (
    source: Node,
    newParent: string | null,
    prev: string | null,
  ): string => {
    const id = makeId();
    nodes.push({
      ...source,
      id,
      parentId: newParent,
      prevSiblingId: prev,
      locked: false,
      bookmarkedAt: null,
      origin: null,
      createdAt: at,
      updatedAt: at,
    });
    let childPrev: string | null = null;
    for (const child of childrenOf(index, source.id))
      childPrev = copyOne(child, id, childPrev);
    return id;
  };

  const rootIds: string[] = [];
  let prev = afterId;
  for (const id of roots) {
    prev = copyOne(index.byId.get(id)!, parentId, prev);
    rootIds.push(prev);
  }

  const siblings = childrenOf(index, parentId);
  const slot =
    afterId === null ? 0 : siblings.findIndex((n) => n.id === afterId) + 1;
  // An afterId that isn't a child of parentId (index -1 -> 0) has no follower.
  const follower =
    rootIds.length > 0 && (afterId === null || slot > 0)
      ? (siblings[slot]?.id ?? null)
      : null;
  return { nodes, rootIds, follower };
}

import { isMirrorsEnabled } from "../data/flags";
import { capture, drop } from "../data/history";
import { getLiveNodes } from "../data/live-nodes";
import { copySubtrees, moveNode } from "../data/mutations";
import { runStructural } from "../data/structural";
import { buildTreeIndex } from "../data/tree";
import { getTreeIndex } from "../data/tree-store";

/**
 * Commit a structural drop that moves or copies one or more roots
 * (docs/workbench/PLAN.md 1.4, 2.6-2.7): a drag into another column, an
 * Alt-drag copy, a multi-selection drag, or a drop on a sidebar target.
 * One `runStructural` batch and one history capture, so a drop is exactly one
 * undo step whichever columns it touched.
 *
 * `parentInstanceId` is a render-hierarchy id: a drop under a mirror lands in
 * its SOURCE (the ADR 0022 field split), so the node windows into every
 * instance. Returns the ids now at the drop slot (the moved roots, or the
 * copies), or an empty list when nothing changed (a locked target, a cycle, a
 * no-op).
 */
export function commitDrop(args: {
  nodeIds: readonly string[];
  parentInstanceId: string | null;
  afterId: string | null;
  copy: boolean;
}): string[] {
  const { nodeIds, parentInstanceId, afterId, copy } = args;
  if (nodeIds.length === 0) return [];
  return runStructural(() => {
    const index = getTreeIndex();
    const parentId =
      isMirrorsEnabled() && parentInstanceId
        ? (index.byId.get(parentInstanceId)?.mirrorOf ?? parentInstanceId)
        : parentInstanceId;
    capture(index, nodeIds[0]!, null, { label: copy ? "copy" : "move" });
    if (copy) {
      const copies = copySubtrees(index, nodeIds, parentId, afterId);
      if (copies.length === 0) drop();
      return copies;
    }
    // Each move reads a fresh index off the live store: the previous move
    // relinked the chains this one splices into.
    const moved: string[] = [];
    let after = afterId;
    for (const id of nodeIds) {
      if (id === after) continue;
      const fresh = buildTreeIndex(getLiveNodes());
      if (moveNode(fresh, id, parentId, after)) moved.push(id);
      else if (fresh.byId.get(id)?.parentId !== parentId) continue;
      after = id;
    }
    if (moved.length === 0) drop();
    return moved;
  });
}

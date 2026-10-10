import { expect, test } from "bun:test";

import { planSubtreeCopy } from "./subtree-copy";
import { buildTreeIndex, createNode } from "./tree";

const AT = 1_000;

// a (locked, bookmarked, by an agent)
//   a1
//     a1x
//   a2 (mirror of z)
// b
//   b1
// z
const INDEX = buildTreeIndex([
  createNode({
    id: "a",
    text: "A [[z]]",
    locked: true,
    bookmarkedAt: 5,
    origin: "agent",
    completed: true,
    collapsed: true,
    isTask: true,
  }),
  createNode({ id: "a1", parentId: "a", text: "A1", kind: "paragraph" }),
  createNode({ id: "a1x", parentId: "a1", text: "A1x" }),
  createNode({ id: "a2", parentId: "a", prevSiblingId: "a1", mirrorOf: "z" }),
  createNode({ id: "b", prevSiblingId: "a", text: "B" }),
  createNode({ id: "b1", parentId: "b", text: "B1" }),
  createNode({ id: "z", prevSiblingId: "b", text: "Z" }),
]);

function counter() {
  let n = 0;
  return () => `c${++n}`;
}

test("a copy remaps ids, rebuilds sibling chains and resets owner state", () => {
  const plan = planSubtreeCopy(INDEX, ["a"], "b", "b1", counter(), AT);
  const byId = new Map(plan.nodes.map((n) => [n.id, n]));
  expect(plan.rootIds).toEqual(["c1"]);
  // The new root lands after b1 under b; its subtree keeps order and shape.
  expect(
    plan.nodes.map((n) => [n.id, n.parentId, n.prevSiblingId, n.text]),
  ).toEqual([
    ["c1", "b", "b1", "A [[z]]"],
    ["c2", "c1", null, "A1"],
    ["c3", "c2", null, "A1x"],
    ["c4", "c1", "c2", ""],
  ]);
  // Kept: content and presentation, and the mirror's source. Dropped: lock,
  // bookmark, provenance. Timestamps are the copy's.
  expect(byId.get("c1")).toMatchObject({
    isTask: true,
    completed: true,
    collapsed: true,
    locked: false,
    bookmarkedAt: null,
    origin: null,
    createdAt: AT,
    updatedAt: AT,
  });
  expect(byId.get("c2")!.kind).toBe("paragraph");
  expect(byId.get("c4")!.mirrorOf).toBe("z");
  // b1 was last under b: nothing follows the copy.
  expect(plan.follower).toBeNull();
});

test("several roots copy in order, skipping ones inside another, and relink the follower", () => {
  // a1 is inside a, so it is not copied twice; the copies go first at the top.
  const plan = planSubtreeCopy(
    INDEX,
    ["b", "a1", "a"],
    null,
    null,
    counter(),
    AT,
  );
  const roots = plan.nodes.filter((n) => plan.rootIds.includes(n.id));
  expect(roots.map((n) => [n.text, n.prevSiblingId])).toEqual([
    ["B", null],
    ["A [[z]]", "c1"],
  ]);
  expect(plan.nodes).toHaveLength(2 + 4);
  // The old head (a) must now follow the last copied root.
  expect(plan.follower).toBe("a");
  // Copying into the middle of a list: the next sibling follows.
  expect(planSubtreeCopy(INDEX, ["z"], null, "a", counter(), AT).follower).toBe(
    "b",
  );
});

import { expect, test } from "bun:test";

import { buildTreeIndex, createNode } from "../data/tree";
import { buildVisibleRows } from "../data/visible-order";
import {
  columnMoveLanding,
  columnMoveSlot,
  type ColumnSlot,
} from "./column-move";

// note
//   n1
//     n1a
//   n2
// other
//   o1
const INDEX = buildTreeIndex([
  createNode({ id: "note", text: "Note" }),
  createNode({ id: "n1", parentId: "note" }),
  createNode({ id: "n1a", parentId: "n1" }),
  createNode({ id: "n2", parentId: "note", prevSiblingId: "n1" }),
  createNode({ id: "other", prevSiblingId: "note" }),
  createNode({ id: "o1", parentId: "other" }),
]);

test.each<[string, string | null, string | null, string[], ColumnSlot]>([
  [
    "after the last-focused node, as its next sibling",
    "note",
    "n1a",
    ["o1"],
    { parentId: "n1", afterId: "n1a" },
  ],
  [
    "never focused: the end of the zoom root",
    "note",
    null,
    ["o1"],
    { parentId: "note", afterId: "n2" },
  ],
  [
    "the focused node left the view: the end",
    "note",
    "o1",
    ["n2"],
    { parentId: "note", afterId: "n1" },
  ],
  [
    "the zoom root's own title: the end",
    "note",
    "note",
    ["o1"],
    { parentId: "note", afterId: "n2" },
  ],
  [
    "inside a moved node: the end, never into itself",
    null,
    "n1a",
    ["n1"],
    { parentId: null, afterId: "other" },
  ],
  [
    "the whole outline accepts any focused node",
    null,
    "o1",
    ["n2"],
    { parentId: "other", afterId: "o1" },
  ],
])("slot: %s", (_name, root, focused, moved, expected) => {
  expect(columnMoveSlot(INDEX, root, focused, new Set(moved))).toEqual(
    expected,
  );
});

test("the caret lands after the moved block, else before it, else on the parent", () => {
  const rows = buildVisibleRows(INDEX, "note", () => false);
  // Moving n1 (with n1a): the next row after the block is n2.
  expect(columnMoveLanding(rows, INDEX, new Set(["n1"]), "note")).toBe("n2");
  // Moving the last row: the row before it.
  expect(columnMoveLanding(rows, INDEX, new Set(["n2"]), "note")).toBe("n1a");
  // Moving every row: the parent, which here is the view's root (its title).
  expect(columnMoveLanding(rows, INDEX, new Set(["n1", "n2"]), "note")).toBe(
    "note",
  );
  // A node not on screen moves nothing here.
  expect(columnMoveLanding(rows, INDEX, new Set(["o1"]), "note")).toBeNull();
});

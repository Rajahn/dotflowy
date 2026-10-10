import { expect, test } from "bun:test";

import { buildTreeIndex, createNode } from "../data/tree";
import { buildVisibleRows, rowKeyFor } from "../data/visible-order";
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

// note2
//   m  (a mirror of src)
//   x
//   lk (locked)
//     l1
// src
//   s1
//   s2
const MIRRORED = buildTreeIndex([
  createNode({ id: "note2", text: "Note 2" }),
  createNode({ id: "m", parentId: "note2", mirrorOf: "src" }),
  createNode({ id: "x", parentId: "note2", prevSiblingId: "m" }),
  createNode({ id: "lk", parentId: "note2", prevSiblingId: "x", locked: true }),
  createNode({ id: "l1", parentId: "lk" }),
  createNode({ id: "src", prevSiblingId: "note2" }),
  createNode({ id: "s1", parentId: "src" }),
  createNode({ id: "s2", parentId: "src", prevSiblingId: "s1" }),
]);

test("a moved mirror takes its expanded rows with it: the caret lands past them", () => {
  const rows = buildVisibleRows(MIRRORED, "note2", () => false, null, true);
  const moved = new Set(["m"]);
  expect(columnMoveLanding(rows, MIRRORED, moved, "note2")).toBe("x");
});

test("a remembered row inside a mirror still anchors the slot", () => {
  const s1Key = rowKeyFor("m", "s1");
  expect(columnMoveSlot(MIRRORED, "note2", s1Key, new Set(["o"]))).toEqual({
    parentId: "src",
    afterId: "s1",
  });
});

test("a locked parent falls back to the end; a mirror root ends after its source's children", () => {
  expect(columnMoveSlot(MIRRORED, "note2", "l1", new Set(["o"]))).toEqual({
    parentId: "note2",
    afterId: "lk",
  });
  expect(columnMoveSlot(MIRRORED, "m", null, new Set(["o"]))).toEqual({
    parentId: "m",
    afterId: "s2",
  });
});

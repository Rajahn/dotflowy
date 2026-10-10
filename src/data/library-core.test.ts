import { expect, test } from "bun:test";

import {
  AGENT_FOLDER_ID,
  agentFolderPlan,
  buildLibraryTree,
  canDeleteFolder,
  isFolderWithin,
  rankBetween,
  rankForDrop,
  rowsInFolder,
  unfiledNodeIds,
  type LibraryItem,
  type LibraryRow,
} from "./library-core";

const folder = (
  id: string,
  rank: string,
  parentId: string | null = null,
): LibraryRow => ({ id, type: "folder", parentId, rank, title: id });
const note = (
  id: string,
  rank: string,
  rootNodeId: string,
  parentId: string | null = null,
): LibraryRow => ({ id, type: "note", parentId, rank, rootNodeId });

/** The tree as nested ids, notes as `id->node`. */
function outlineOf(items: readonly LibraryItem[]): unknown[] {
  return items.map((item) =>
    item.kind === "folder"
      ? { [item.row.id]: outlineOf(item.children) }
      : `${item.row.id}->${item.rootNodeId}`,
  );
}

test("ranks always land strictly between their neighbours", () => {
  // Repeatedly inserting at the front, the back and the middle never collides
  // and keeps plain string order.
  const ranks = [rankBetween(null, null)];
  for (let i = 0; i < 40; i++) {
    ranks.unshift(rankBetween(null, ranks[0]));
    ranks.push(rankBetween(ranks.at(-1), null));
    const mid = Math.floor(ranks.length / 2);
    ranks.splice(mid, 0, rankBetween(ranks[mid - 1], ranks[mid]));
  }
  const sorted = [...ranks].sort();
  expect(ranks).toEqual(sorted);
  expect(new Set(ranks).size).toBe(ranks.length);
  // Out-of-order neighbours (two devices ranked concurrently) still yield a
  // key after the larger one instead of throwing.
  expect(rankBetween("m", "c") > "m").toBe(true);
});

test("the tree nests folders and notes in rank order and hides dead notes", () => {
  const rows = [
    folder("work", "m"),
    folder("ideas", "c"),
    folder("sub", "a", "work"),
    note("n-plan", "t", "plan", "work"),
    note("n-old", "b", "deleted-node", "work"),
    note("n-inner", "u", "moved-inside", "work"),
    note("n-dup", "v", "plan", "ideas"),
    note("n-orphan", "z", "loose", "gone-folder"),
  ];
  const topLevel = new Set(["plan", "loose", "inbox"]);
  const tree = buildLibraryTree(rows, topLevel);
  // n-old (node gone) and n-inner (node no longer top-level) are hidden; the
  // second row for `plan` loses to the first in tree order... which is the one
  // inside `ideas`, since `ideas` (rank c) sorts before `work` (rank m). A row
  // whose folder is gone shows at the root.
  expect(outlineOf(tree)).toEqual([
    { ideas: ["n-dup->plan"] },
    { work: [{ sub: [] }] },
    "n-orphan->loose",
  ]);
  // Unfiled: top-level nodes no visible note opens, minus exclusions.
  expect(unfiledNodeIds(["inbox", "plan", "daily", "loose"], tree)).toEqual([
    "inbox",
    "daily",
  ]);
  expect(
    unfiledNodeIds(["inbox", "plan", "daily"], tree, new Set(["daily"])),
  ).toEqual(["inbox"]);
  // Only an empty folder can be deleted; hidden notes don't count.
  expect(canDeleteFolder(tree, "sub")).toBe(true);
  expect(canDeleteFolder(tree, "ideas")).toBe(false);
  expect(canDeleteFolder(buildLibraryTree(rows, new Set()), "work")).toBe(
    false,
  );
  expect(
    canDeleteFolder(
      buildLibraryTree([folder("w", "a"), note("n", "b", "x", "w")], new Set()),
      "w",
    ),
  ).toBe(true);
});

test("a folder cycle still shows every folder, at the root", () => {
  const rows = [folder("a", "a", "b"), folder("b", "b", "a")];
  expect(outlineOf(buildLibraryTree(rows, new Set()))).toEqual([
    { a: [] },
    { b: [] },
  ]);
});

test("folder containment and drop ranks", () => {
  const rows = [folder("a", "a"), folder("b", "b", "a"), folder("c", "c", "b")];
  expect(isFolderWithin(rows, "c", "a")).toBe(true);
  expect(isFolderWithin(rows, "a", "a")).toBe(true);
  expect(isFolderWithin(rows, "a", "c")).toBe(false);
  expect(isFolderWithin(rows, null, "a")).toBe(false);

  const siblings = [folder("x", "c"), folder("y", "g")];
  const first = rankForDrop(siblings, "x");
  const middle = rankForDrop(siblings, "y");
  const last = rankForDrop(siblings, null);
  expect(first < "c").toBe(true);
  expect(middle > "c" && middle < "g").toBe(true);
  expect(last > "g").toBe(true);
});

test("rankBetween lands right after a tied or out-of-order neighbour, and treats an empty rank as open", () => {
  const tied = rankBetween("i", "i");
  expect(tied > "i").toBe(true);
  expect(tied < "r").toBe(true);
  const swapped = rankBetween("r", "i");
  expect(swapped > "r").toBe(true);
  expect(swapped < "s").toBe(true);
  expect(rankBetween("", "")).toBe(rankBetween(null, null));
  expect(rankBetween("i", "")).toBe(rankBetween("i", null));
});

const named = (id: string, title: string, parentId: string | null = null) =>
  ({ id, type: "folder", parentId, rank: "m", title }) satisfies LibraryRow;

test("agentFolderPlan reuses a top-level folder named Agent in any case, else claims the fixed id", () => {
  expect(agentFolderPlan([])).toEqual({ id: AGENT_FOLDER_ID, create: true });
  expect(agentFolderPlan([named("f1", " agent ")])).toEqual({
    id: "f1",
    create: false,
  });
  // A nested "Agent" folder doesn't count; one whose parent is gone is drawn
  // at the top, so it does.
  expect(
    agentFolderPlan([named("f0", "Work"), named("f1", "Agent", "f0")]).create,
  ).toBe(true);
  expect(agentFolderPlan([named("f1", "Agent", "gone")]).id).toBe("f1");
});

test("agentFolderPlan leaves a renamed folder its fixed id and takes another", () => {
  expect(agentFolderPlan([named(AGENT_FOLDER_ID, "Research")])).toEqual({
    id: `${AGENT_FOLDER_ID}_2`,
    create: true,
  });
});

test("rowsInFolder counts a row whose folder is gone at the root", () => {
  const rows: LibraryRow[] = [
    { id: "n1", type: "note", parentId: null, rank: "a", rootNodeId: "x" },
    { id: "n2", type: "note", parentId: "gone", rank: "m", rootNodeId: "y" },
  ];
  expect(rowsInFolder(rows, null).map((r) => r.id)).toEqual(["n1", "n2"]);
  expect(rowsInFolder(rows, "gone")).toEqual([]);
});

// Pure logic for the library: the sidebar's folders and notes
// (docs/workbench/PLAN.md 1.2, 2.5). The `saved-queries-core.ts` discipline:
// no collection imports, no DOM (only Effect Schema, for the row decoder), so
// it stays bun-testable. The collection + reactive reads live in `library.ts`.
//
// A NOTE is an ordinary top-level outline node (`parentId === null`) that the
// library has registered under a folder; its title is that node's text, read
// live, so a note never stores a second copy of its name. A FOLDER exists only
// in the library and only groups notes. Every top-level node no visible note
// row points at is UNFILED.
//
// The worker's MCP library tools (worker/mcp-tools.ts) share this module, so
// the row schema lives here: one decoder for the client collection and the
// agent's writes.

import { Schema } from "effect";

/** The stored row, decoded at both ends (the client collection, MCP). Typed
 *  against {@link LibraryRow}, so the two can't drift apart. */
export const LibraryRowSchema: Schema.Codec<LibraryRow> = Schema.Struct({
  id: Schema.String,
  type: Schema.Literals(["folder", "note"]),
  parentId: Schema.NullOr(Schema.String),
  rank: Schema.String,
  title: Schema.optional(Schema.String),
  rootNodeId: Schema.optional(Schema.String),
});

/** One library row, stored as a kv side-collection item. */
export interface LibraryRow {
  id: string;
  type: "folder" | "note";
  /** The parent folder's id, or null at the library root. */
  parentId: string | null;
  /** Fractional sort key among siblings (see {@link rankBetween}): a move
   *  rewrites only the moved row. */
  rank: string;
  /** Folders only: the folder's name. */
  title?: string;
  /** Notes only: the top-level node the note shows. */
  rootNodeId?: string;
}

// --- Fractional ranks -------------------------------------------------------

const DIGITS = "0123456789abcdefghijklmnopqrstuvwxyz";

/** A key strictly between `a` and `b` in plain string order ("" and null
 *  stand for the open ends). Both bounds must themselves be keys this function
 *  produced, which never end in "0". */
function midpoint(a: string, b: string | null): string {
  if (b !== null) {
    let n = 0;
    while ((a[n] ?? "0") === b[n]) n++;
    if (n > 0) return b.slice(0, n) + midpoint(a.slice(n), b.slice(n));
  }
  const digitA = a ? DIGITS.indexOf(a[0]!) : 0;
  const digitB = b !== null ? DIGITS.indexOf(b[0]!) : DIGITS.length;
  if (digitB - digitA > 1) return DIGITS[Math.round((digitA + digitB) / 2)]!;
  // Adjacent first digits: keep b's first digit when b is longer, else keep
  // a's and recurse into the open range after it.
  if (b !== null && b.length > 1) return b.slice(0, 1);
  return DIGITS[digitA]! + midpoint(a.slice(1), null);
}

/** A rank that sorts after `before` and before `after` (either may be absent:
 *  first, last, or only position). */
export function rankBetween(
  before: string | null | undefined,
  after: string | null | undefined,
): string {
  // An empty rank (no writer of ours makes one) counts as an open end.
  const lo = before || "";
  const hi = after || null;
  if (lo && hi !== null && lo >= hi) {
    // Tied or out-of-order siblings (two devices ranked concurrently): nothing
    // fits strictly between, so land right after `before` -- a key that
    // extends it sorts after it and before anything above it.
    return lo + midpoint("", null);
  }
  return midpoint(lo, hi);
}

/** Rank order, ties broken by id so every device draws the same list. */
export function compareRank(a: LibraryRow, b: LibraryRow): number {
  if (a.rank !== b.rank) return a.rank < b.rank ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

// --- The visible tree -------------------------------------------------------

export interface LibraryFolderItem {
  kind: "folder";
  row: LibraryRow;
  children: LibraryItem[];
}

export interface LibraryNoteItem {
  kind: "note";
  row: LibraryRow;
  /** The node the note opens (always a live top-level node here). */
  rootNodeId: string;
}

export type LibraryItem = LibraryFolderItem | LibraryNoteItem;

/**
 * The sidebar tree: folders and notes nested by `parentId`, each level in rank
 * order. A note row is HIDDEN while its node is missing or no longer top-level
 * (a deleted note, or one moved inside another outline) -- the row stays, so
 * undoing the delete brings the note back where it was (PLAN 1.2). A second
 * row for the same node is hidden too: the first one in tree order wins. A row
 * whose folder is gone shows at the library root.
 */
export function buildLibraryTree(
  rows: readonly LibraryRow[],
  topLevelIds: ReadonlySet<string>,
): LibraryItem[] {
  const folderIds = new Set(
    rows.filter((r) => r.type === "folder").map((r) => r.id),
  );
  const parentOf = new Map(rows.map((r) => [r.id, r.parentId]));
  const byParent = new Map<string | null, LibraryRow[]>();
  for (const row of rows) {
    // A folder caught in a cycle (two devices moving folders into each other)
    // would be unreachable from the root; it shows at the root instead.
    const parent =
      row.parentId !== null &&
      folderIds.has(row.parentId) &&
      !(row.type === "folder" && folderWithin(parentOf, row.parentId, row.id))
        ? row.parentId
        : null;
    const list = byParent.get(parent);
    if (list) list.push(row);
    else byParent.set(parent, [row]);
  }
  const claimed = new Set<string>();
  const level = (parent: string | null): LibraryItem[] => {
    const items: LibraryItem[] = [];
    for (const row of [...(byParent.get(parent) ?? [])].sort(compareRank)) {
      if (row.type === "folder") {
        items.push({ kind: "folder", row, children: level(row.id) });
        continue;
      }
      const nodeId = row.rootNodeId;
      if (!nodeId || !topLevelIds.has(nodeId) || claimed.has(nodeId)) continue;
      claimed.add(nodeId);
      items.push({ kind: "note", row, rootNodeId: nodeId });
    }
    return items;
  };
  return level(null);
}

/** Every node id a visible note in `tree` opens. */
export function filedNodeIds(tree: readonly LibraryItem[]): Set<string> {
  const ids = new Set<string>();
  const walk = (items: readonly LibraryItem[]) => {
    for (const item of items) {
      if (item.kind === "note") ids.add(item.rootNodeId);
      else walk(item.children);
    }
  };
  walk(tree);
  return ids;
}

/**
 * The UNFILED top-level nodes, in outline order: every top-level node no
 * visible note opens (seed data, older outlines, MCP-created roots), minus
 * `exclude` (the Daily container, which has its own sidebar entry).
 */
export function unfiledNodeIds(
  topLevelOrder: readonly string[],
  tree: readonly LibraryItem[],
  exclude: ReadonlySet<string> = new Set(),
): string[] {
  const filed = filedNodeIds(tree);
  return topLevelOrder.filter((id) => !filed.has(id) && !exclude.has(id));
}

/** The visible items directly inside `folderId` (null = the library root). */
export function childrenOfFolder(
  tree: readonly LibraryItem[],
  folderId: string | null,
): LibraryItem[] {
  if (folderId === null) return [...tree];
  const find = (items: readonly LibraryItem[]): LibraryItem[] | undefined => {
    for (const item of items) {
      if (item.kind !== "folder") continue;
      if (item.row.id === folderId) return item.children;
      const found = find(item.children);
      if (found) return found;
    }
    return undefined;
  };
  return find(tree) ?? [];
}

/** Whether a folder may be deleted: only an empty one, in this first version
 *  (PLAN 1.2). Hidden notes do not count. */
export function canDeleteFolder(
  tree: readonly LibraryItem[],
  folderId: string,
): boolean {
  return childrenOfFolder(tree, folderId).length === 0;
}

/** Whether `folderId` is `ancestorId` or sits somewhere inside it -- a folder
 *  can't move into itself or its own descendants. */
export function isFolderWithin(
  rows: readonly LibraryRow[],
  folderId: string | null,
  ancestorId: string,
): boolean {
  return folderWithin(
    new Map(rows.map((r) => [r.id, r.parentId])),
    folderId,
    ancestorId,
  );
}

function folderWithin(
  parentOf: ReadonlyMap<string, string | null>,
  folderId: string | null,
  ancestorId: string,
): boolean {
  let cursor = folderId;
  const seen = new Set<string>();
  while (cursor !== null && !seen.has(cursor)) {
    if (cursor === ancestorId) return true;
    seen.add(cursor);
    cursor = parentOf.get(cursor) ?? null;
  }
  return false;
}

/**
 * The rank for an item dropped into `folderId` before `beforeId` (null =
 * last). `siblings` are that folder's rows in rank order, excluding the moved
 * row itself.
 */
export function rankForDrop(
  siblings: readonly LibraryRow[],
  beforeId: string | null,
): string {
  const i =
    beforeId === null
      ? siblings.length
      : siblings.findIndex((r) => r.id === beforeId);
  const at = i < 0 ? siblings.length : i;
  return rankBetween(siblings[at - 1]?.rank, siblings[at]?.rank);
}

/** The rows directly inside `folderId` (null = the library root), in rank
 *  order, minus `exceptId`. */
export function rowsInFolder(
  rows: readonly LibraryRow[],
  folderId: string | null,
  exceptId?: string,
): LibraryRow[] {
  return rows
    .filter((r) => r.parentId === folderId && r.id !== exceptId)
    .sort(compareRank);
}

// --- The Agent folder ---------------------------------------------------------

/** The name of the folder agents file their new notes in (PLAN 1.10). */
export const AGENT_FOLDER_TITLE = "Agent";
/** The id the Agent folder gets when an agent creates it: fixed, so two agent
 *  writes racing to create it write the same row instead of two folders. */
export const AGENT_FOLDER_ID = "f_agent";

export interface AgentFolderPlan {
  id: string;
  /** The folder doesn't exist yet: write it with the note. */
  create: boolean;
}

/**
 * Where an agent's new note goes: the first folder named "Agent" (any case)
 * drawn at the top of the library, else a new one -- under the fixed id,
 * unless a row already holds that id (`taken` also counts stored rows that
 * didn't decode).
 */
export function agentFolderPlan(
  rows: readonly LibraryRow[],
  taken: ReadonlySet<string> = new Set(),
): AgentFolderPlan {
  // Drawn at the top: a folder whose parent is gone, or caught in a cycle,
  // shows there too (buildLibraryTree).
  const existing = buildLibraryTree(rows, new Set()).find(
    (item) =>
      item.kind === "folder" &&
      item.row.title?.trim().toLowerCase() === AGENT_FOLDER_TITLE.toLowerCase(),
  );
  if (existing) return { id: existing.row.id, create: false };
  const ids = new Set([...taken, ...rows.map((r) => r.id)]);
  let id = AGENT_FOLDER_ID;
  for (let n = 2; ids.has(id); n++) id = `${AGENT_FOLDER_ID}_${n}`;
  return { id, create: true };
}

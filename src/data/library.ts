import { queryCollectionOptions } from "@tanstack/query-db-collection";
import { createCollection } from "@tanstack/react-db";
import { Schema } from "effect";
import { useMemo, useSyncExternalStore } from "react";

import { hasCryptoRandomUuid, hasWindow } from "../env";
import { kvDelete, kvFetch, kvPut, toKvKeys, toKvRows } from "./kv-api";
import {
  buildLibraryTree,
  compareRank,
  rankForDrop,
  type LibraryItem,
  type LibraryRow,
} from "./library-core";
import { queryClient } from "./query-client";
import { useVisibleChildIds } from "./tree-store";

/**
 * The library: the sidebar's folders and notes (docs/workbench/PLAN.md 1.2,
 * 2.5). Stored as the `library` kv side-collection over /api/kv -- the
 * saved-queries pattern -- so it rides the per-user DO, syncs across devices
 * on focus, is covered by R2 backups with the rest of the kv table, and needs
 * no `Node` field or migration. A note row only points at a top-level node;
 * the note's title is that node's text.
 *
 * Library changes are side data: they are not undo steps (ADR 0064). Deleting
 * a note deletes its node (an undoable outline edit) and keeps the row, which
 * the tree hides while the node is gone -- so undo brings the note back.
 *
 * Reactive reads use `subscribeChanges` + `useSyncExternalStore` (NOT
 * `useLiveQuery`, which hard-fails the `/` prerender -- ADR 0004).
 */

const libraryRowSchema = Schema.Struct({
  id: Schema.String,
  type: Schema.Literals(["folder", "note"]),
  parentId: Schema.NullOr(Schema.String),
  rank: Schema.String,
  title: Schema.optional(Schema.String),
  rootNodeId: Schema.optional(Schema.String),
});

const KV = "library";

export const libraryCollection = createCollection(
  queryCollectionOptions({
    id: "library",
    queryKey: ["kv", KV],
    queryClient,
    queryFn: () => kvFetch<LibraryRow>(KV),
    getKey: (row: LibraryRow) => row.id,
    schema: Schema.toStandardSchemaV1(libraryRowSchema),
    onInsert: async ({ transaction }) => {
      await kvPut(KV, toKvRows(transaction));
      return { refetch: false };
    },
    onUpdate: async ({ transaction }) => {
      await kvPut(KV, toKvRows(transaction));
      return { refetch: false };
    },
    onDelete: async ({ transaction }) => {
      await kvDelete(KV, toKvKeys(transaction));
      return { refetch: false };
    },
  }),
);

function liveRows(): LibraryRow[] {
  return libraryCollection.toArray;
}

function newRowId(prefix: string): string {
  return hasCryptoRandomUuid()
    ? `${prefix}_${crypto.randomUUID()}`
    : `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

/** The rows directly inside `folderId`, in rank order, minus `exceptId`. */
function siblingsIn(folderId: string | null, exceptId?: string): LibraryRow[] {
  return liveRows()
    .filter((r) => r.parentId === folderId && r.id !== exceptId)
    .sort(compareRank);
}

// --- Mutations --------------------------------------------------------------

/** Add a folder at the end of `parentId` (null = the library root). */
export function createFolder(parentId: string | null, title: string): string {
  const id = newRowId("f");
  libraryCollection.insert({
    id,
    type: "folder",
    parentId,
    rank: rankForDrop(siblingsIn(parentId), null),
    title: title.trim() || "Untitled folder",
  });
  return id;
}

/** Rename a folder. A blank name is ignored. */
export function renameFolder(id: string, title: string): void {
  const t = title.trim();
  if (!t || !liveRows().some((r) => r.id === id)) return;
  libraryCollection.update(id, (draft) => void (draft.title = t));
}

/** Remove a library row (an empty folder; callers check emptiness). */
export function deleteLibraryRow(id: string): void {
  if (!liveRows().some((r) => r.id === id)) return;
  libraryCollection.delete(id);
}

/**
 * File the top-level node `nodeId` as a note in `folderId`, before `beforeId`
 * (null = last). A node already registered moves its existing row instead of
 * gaining a second one.
 */
export function fileNote(
  nodeId: string,
  folderId: string | null,
  beforeId: string | null = null,
): string {
  const existing = liveRows().find(
    (r) => r.type === "note" && r.rootNodeId === nodeId,
  );
  if (existing) {
    moveLibraryRow(existing.id, folderId, beforeId);
    return existing.id;
  }
  const id = newRowId("n");
  libraryCollection.insert({
    id,
    type: "note",
    parentId: folderId,
    rank: rankForDrop(siblingsIn(folderId), beforeId),
    rootNodeId: nodeId,
  });
  return id;
}

/** Move a row into `folderId`, before `beforeId` (null = last). Rewrites only
 *  the moved row (its parent and rank). */
export function moveLibraryRow(
  id: string,
  folderId: string | null,
  beforeId: string | null,
): void {
  const row = liveRows().find((r) => r.id === id);
  if (!row) return;
  const rank = rankForDrop(siblingsIn(folderId, id), beforeId);
  if (row.parentId === folderId && row.rank === rank) return;
  libraryCollection.update(id, (draft) => {
    draft.parentId = folderId;
    draft.rank = rank;
  });
}

// --- Reactive read ------------------------------------------------------------

const EMPTY: LibraryRow[] = [];
let rows: LibraryRow[] = EMPTY;
const listeners = new Set<() => void>();
let started = false;

function ensureStarted() {
  if (started || !hasWindow()) return;
  started = true;
  libraryCollection.subscribeChanges(
    () => {
      rows = libraryCollection.toArray;
      for (const l of listeners) l();
    },
    { includeInitialState: true },
  );
}

function subscribe(cb: () => void): () => void {
  ensureStarted();
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function getRows(): LibraryRow[] {
  ensureStarted();
  return rows;
}

/** Every library row, reactive. */
export function useLibraryRows(): LibraryRow[] {
  return useSyncExternalStore(subscribe, getRows, () => EMPTY);
}

const NEVER_HIDDEN = () => false;

/** The top-level node ids, in outline order, reactive (structure only). */
export function useTopLevelIds(): string[] {
  return useVisibleChildIds(null, NEVER_HIDDEN);
}

/** The visible library tree (see `buildLibraryTree`), reactive to both the
 *  library rows and the outline's top-level structure. */
export function useLibraryTree(): LibraryItem[] {
  const libraryRows = useLibraryRows();
  const topLevel = useTopLevelIds();
  return useMemo(
    () => buildLibraryTree(libraryRows, new Set(topLevel)),
    [libraryRows, topLevel],
  );
}

/** The node a note row opens, or null for a folder or unknown row. */
export function libraryNoteRoot(rowId: string): string | null {
  const row = liveRows().find((r) => r.id === rowId);
  return row?.type === "note" ? (row.rootNodeId ?? null) : null;
}

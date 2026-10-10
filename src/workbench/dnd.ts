import type { DragEvent } from "react";

import { Option, Schema } from "effect";

/**
 * The workbench's native (HTML) drag payloads: a sidebar row or unfiled node,
 * and a tab. They ride `dataTransfer` under their own media types, so the
 * outline's pointer drag (use-drag-reorder.ts) never sees them, and they are
 * decoded at the boundary -- another tab or app can drop anything here.
 */

const LIBRARY_TYPE = "application/x-dotflowy-library";
const TAB_TYPE = "application/x-dotflowy-tab";

const LibraryDragSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("row"), id: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("node"), nodeId: Schema.String }),
]);
/** A sidebar drag: a library row (folder or note), or an unfiled node. */
export type LibraryDrag = Schema.Schema.Type<typeof LibraryDragSchema>;
const decodeLibraryDrag = Schema.decodeUnknownOption(
  Schema.fromJsonString(LibraryDragSchema),
);

const TabDragSchema = Schema.Struct({ tabId: Schema.String });
const decodeTabDrag = Schema.decodeUnknownOption(
  Schema.fromJsonString(TabDragSchema),
);

export function startLibraryDrag(e: DragEvent, drag: LibraryDrag): void {
  e.stopPropagation();
  e.dataTransfer.effectAllowed = "move";
  e.dataTransfer.setData(LIBRARY_TYPE, JSON.stringify(drag));
}

export function hasLibraryDrag(e: DragEvent): boolean {
  return e.dataTransfer.types.includes(LIBRARY_TYPE);
}

export function readLibraryDrag(e: DragEvent): LibraryDrag | null {
  return Option.getOrNull(
    decodeLibraryDrag(e.dataTransfer.getData(LIBRARY_TYPE)),
  );
}

export function startTabDrag(e: DragEvent, tabId: string): void {
  e.stopPropagation();
  e.dataTransfer.effectAllowed = "move";
  e.dataTransfer.setData(TAB_TYPE, JSON.stringify({ tabId }));
}

export function hasTabDrag(e: DragEvent): boolean {
  return e.dataTransfer.types.includes(TAB_TYPE);
}

export function readTabDrag(e: DragEvent): string | null {
  return Option.getOrNull(
    Option.map(decodeTabDrag(e.dataTransfer.getData(TAB_TYPE)), (d) => d.tabId),
  );
}

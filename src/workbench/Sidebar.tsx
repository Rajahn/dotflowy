import {
  ArrowDown01Icon,
  ArrowRight01Icon,
  Folder01Icon,
  FolderAddIcon,
  Home01Icon,
  InboxIcon,
  MoreHorizontalIcon,
  Note01Icon,
  NoteAddIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import { Option, Schema } from "effect";
import {
  useState,
  useSyncExternalStore,
  type DragEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";

import {
  ResponsiveMenu,
  ResponsiveMenuContent,
  ResponsiveMenuItem,
  ResponsiveMenuTrigger,
} from "../components/ui/responsive-menu";
import { getNodeActionBridge } from "../data/command-bridge";
import { capture } from "../data/history";
import {
  createFolder,
  deleteLibraryRow,
  fileNote,
  moveLibraryRow,
  renameFolder,
  useLibraryRows,
  useLibraryTree,
  useTopLevelIds,
} from "../data/library";
import {
  canDeleteFolder,
  isFolderWithin,
  unfiledNodeIds,
  type LibraryItem,
  type LibraryRow,
} from "../data/library-core";
import { insertSibling } from "../data/mutations";
import { flattenNodeText } from "../data/node-links";
import { getActivePaneId } from "../data/panes";
import { runStructural } from "../data/structural";
import { childrenOf, type TreeIndex } from "../data/tree";
import { getTreeIndex, useNode } from "../data/tree-store";
import { usePluginChrome } from "../plugins/registry";
import { useActivePaneRootId } from "./hooks";
import { getActivePaneTab, zoomPane } from "./store";

/**
 * The workbench sidebar (docs/workbench/PLAN.md 1.2): the library's folders
 * and notes, between two fixed parts -- "Whole outline" and the plugins'
 * entries (Daily) on top, the virtual "Unfiled" folder of every top-level
 * node no note points at below. Clicking a note opens it in the active pane.
 *
 * Folders and notes rearrange by drag (native HTML drag and drop, so the
 * outline's own pointer drag is untouched): drop on a folder to move into it,
 * on the top or bottom edge of a row to place before or after it. Dragging an
 * unfiled node into a folder files it as a note.
 */
export function Sidebar() {
  const tree = useLibraryTree();
  const rows = useLibraryRows();
  const topLevel = useTopLevelIds();
  const { sidebarEntries } = usePluginChrome();
  const activeRoot = useActivePaneRootId();
  const collapsed = useCollapsedFolders();
  // The folder a new note or folder lands in: the last folder you clicked.
  const [currentFolder, setCurrentFolder] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);

  const ownedByEntries = new Set(
    sidebarEntries.flatMap((e) => {
      const id = e.nodeId();
      return id ? [id] : [];
    }),
  );
  const unfiled = unfiledNodeIds(topLevel, tree, ownedByEntries);
  const folderTarget =
    currentFolder && rows.some((r) => r.id === currentFolder)
      ? currentFolder
      : null;

  const open = (nodeId: string | null) => zoomPane(getActivePaneId(), nodeId);

  const newFolder = () => {
    const id = createFolder(folderTarget, "New folder");
    if (folderTarget) setCollapsed(folderTarget, false);
    setRenaming(id);
  };

  return (
    <nav
      aria-label="Library"
      className="workbench-sidebar flex h-dvh w-60 shrink-0 flex-col overflow-y-auto border-r bg-sidebar text-sm text-sidebar-foreground"
    >
      <div className="flex items-center gap-1 px-3 pt-3 pb-1">
        <span className="flex-1 text-xs font-medium text-muted-foreground">
          Notes
        </span>
        <SidebarIconButton
          icon={NoteAddIcon}
          label="New note"
          onClick={() => {
            const nodeId = createNote(folderTarget);
            if (folderTarget) setCollapsed(folderTarget, false);
            if (nodeId)
              zoomPane(getActivePaneId(), nodeId, { selectTitle: true });
          }}
        />
        <SidebarIconButton
          icon={FolderAddIcon}
          label="New folder"
          onClick={newFolder}
        />
      </div>

      <ul className="px-2 pb-1">
        <li>
          <SidebarRow
            icon={Home01Icon}
            active={activeRoot === null}
            onClick={() => {
              // Back to the top: new notes and folders land at the root too.
              setCurrentFolder(null);
              open(null);
            }}
          >
            Whole outline
          </SidebarRow>
        </li>
        {sidebarEntries.map((entry) => (
          <li key={entry.id}>
            <SidebarRow
              iconComponent={entry.icon}
              active={activeRoot !== null && activeRoot === entry.nodeId()}
              onClick={() => entry.open((id) => open(id))}
            >
              {entry.label}
            </SidebarRow>
          </li>
        ))}
      </ul>

      <ul
        className="flex-1 px-2 pb-2"
        aria-label="Folders and notes"
        onDragOver={(e) => {
          if (hasLibraryDrag(e)) {
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
          }
        }}
        onDrop={(e) => {
          // A drop on the empty space below the tree goes to the library root.
          if (e.target !== e.currentTarget) return;
          e.preventDefault();
          dropInto(readLibraryDrag(e), rows, null, null);
        }}
      >
        <LibraryLevel
          items={tree}
          depth={0}
          rows={rows}
          collapsed={collapsed}
          activeRoot={activeRoot}
          currentFolder={folderTarget}
          renaming={renaming}
          setRenaming={setRenaming}
          onSelectFolder={setCurrentFolder}
          onOpen={open}
        />
      </ul>

      <UnfiledSection
        ids={unfiled}
        activeRoot={activeRoot}
        open={!collapsed.has(UNFILED_KEY)}
        onToggle={() => setCollapsed(UNFILED_KEY, !collapsed.has(UNFILED_KEY))}
        onOpen={open}
      />
    </nav>
  );
}

// --- the tree ---------------------------------------------------------------

interface LevelProps {
  items: readonly LibraryItem[];
  depth: number;
  rows: readonly LibraryRow[];
  collapsed: ReadonlySet<string>;
  activeRoot: string | null;
  currentFolder: string | null;
  renaming: string | null;
  setRenaming: (id: string | null) => void;
  onSelectFolder: (id: string | null) => void;
  onOpen: (nodeId: string) => void;
}

function LibraryLevel(props: LevelProps) {
  const { items, depth } = props;
  return (
    <>
      {items.map((item, i) =>
        item.kind === "folder" ? (
          <FolderItem
            key={item.row.id}
            {...props}
            item={item}
            depth={depth}
            nextId={items[i + 1]?.row.id ?? null}
          />
        ) : (
          <NoteItem
            key={item.row.id}
            row={item.row}
            nodeId={item.rootNodeId}
            depth={depth}
            rows={props.rows}
            nextId={items[i + 1]?.row.id ?? null}
            active={props.activeRoot === item.rootNodeId}
            onOpen={props.onOpen}
          />
        ),
      )}
    </>
  );
}

function FolderItem(
  props: LevelProps & {
    item: Extract<LibraryItem, { kind: "folder" }>;
    nextId: string | null;
  },
) {
  const { item, depth, rows, collapsed, renaming, setRenaming } = props;
  const id = item.row.id;
  const isOpen = !collapsed.has(id);
  const title = item.row.title || "Untitled folder";
  const [dropZone, setDropZone] = useState<DropZone | null>(null);

  const remove = () => {
    if (!canDeleteFolder(props.items, id) && item.children.length > 0) {
      toast("Move or delete the notes in this folder first.");
      return;
    }
    deleteLibraryRow(id);
    if (props.currentFolder === id) props.onSelectFolder(null);
  };

  return (
    <li>
      <div
        className={cn(
          "group relative flex items-center rounded-md",
          props.currentFolder === id && "bg-sidebar-accent/60",
          dropZone === "into" && "ring-2 ring-primary/50",
        )}
        style={{ paddingInlineStart: depth * 12 }}
        draggable={renaming !== id}
        data-library-row={id}
        onDragStart={(e) => startLibraryDrag(e, { kind: "row", id })}
        onDragOver={(e) => {
          if (!hasLibraryDrag(e)) return;
          e.preventDefault();
          e.stopPropagation();
          e.dataTransfer.dropEffect = "move";
          setDropZone(zoneFor(e, true));
        }}
        onDragLeave={() => setDropZone(null)}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          const zone = zoneFor(e, true);
          setDropZone(null);
          const drag = readLibraryDrag(e);
          if (zone === "into") {
            dropInto(drag, rows, id, null);
            setCollapsed(id, false);
          } else
            dropInto(
              drag,
              rows,
              item.row.parentId,
              zone === "before" ? id : props.nextId,
            );
        }}
      >
        <DropLine zone={dropZone} />
        {renaming === id ? (
          <RenameInput
            initial={title}
            label="Folder name"
            onDone={(next) => {
              if (next !== null) renameFolder(id, next);
              setRenaming(null);
            }}
          />
        ) : (
          <button
            type="button"
            className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-2 py-1 text-left hover:bg-sidebar-accent"
            aria-expanded={isOpen}
            onClick={() => {
              setCollapsed(id, isOpen);
              props.onSelectFolder(id);
            }}
            onDoubleClick={() => setRenaming(id)}
          >
            <HugeiconsIcon
              icon={isOpen ? ArrowDown01Icon : ArrowRight01Icon}
              className="size-3.5 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
            <HugeiconsIcon
              icon={Folder01Icon}
              className="size-4 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
            <span className="truncate">{title}</span>
          </button>
        )}
        <RowMenu label={`${title} options`}>
          <ResponsiveMenuItem
            onClick={() => {
              const nodeId = createNote(id);
              setCollapsed(id, false);
              if (nodeId)
                zoomPane(getActivePaneId(), nodeId, { selectTitle: true });
            }}
          >
            New note here
          </ResponsiveMenuItem>
          <ResponsiveMenuItem
            onClick={() => {
              setRenaming(createFolder(id, "New folder"));
              setCollapsed(id, false);
            }}
          >
            New folder here
          </ResponsiveMenuItem>
          <ResponsiveMenuItem onClick={() => setRenaming(id)}>
            Rename
          </ResponsiveMenuItem>
          <ResponsiveMenuItem onClick={remove}>
            Delete folder
          </ResponsiveMenuItem>
        </RowMenu>
      </div>
      {isOpen && item.children.length > 0 && (
        <ul>
          <LibraryLevel {...props} items={item.children} depth={depth + 1} />
        </ul>
      )}
    </li>
  );
}

function NoteItem({
  row,
  nodeId,
  depth,
  rows,
  nextId,
  active,
  onOpen,
}: {
  row: LibraryRow;
  nodeId: string;
  depth: number;
  rows: readonly LibraryRow[];
  nextId: string | null;
  active: boolean;
  onOpen: (nodeId: string) => void;
}) {
  const title = useNoteTitle(nodeId);
  const [renaming, setRenaming] = useState(false);
  const [dropZone, setDropZone] = useState<DropZone | null>(null);
  return (
    <li>
      <div
        className="group relative flex items-center rounded-md"
        style={{ paddingInlineStart: depth * 12 }}
        draggable={!renaming}
        data-library-row={row.id}
        onDragStart={(e) => startLibraryDrag(e, { kind: "row", id: row.id })}
        onDragOver={(e) => {
          if (!hasLibraryDrag(e)) return;
          e.preventDefault();
          e.stopPropagation();
          e.dataTransfer.dropEffect = "move";
          setDropZone(zoneFor(e, false));
        }}
        onDragLeave={() => setDropZone(null)}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          const zone = zoneFor(e, false);
          setDropZone(null);
          dropInto(
            readLibraryDrag(e),
            rows,
            row.parentId,
            zone === "before" ? row.id : nextId,
          );
        }}
      >
        <DropLine zone={dropZone} />
        {renaming ? (
          <RenameInput
            initial={title}
            label="Note name"
            onDone={(next) => {
              if (next !== null) renameNote(nodeId, next);
              setRenaming(false);
            }}
          />
        ) : (
          <SidebarRow
            icon={Note01Icon}
            active={active}
            onClick={() => onOpen(nodeId)}
            onDoubleClick={() => setRenaming(true)}
          >
            {title}
          </SidebarRow>
        )}
        <RowMenu label={`${title} options`}>
          <ResponsiveMenuItem onClick={() => setRenaming(true)}>
            Rename
          </ResponsiveMenuItem>
          <ResponsiveMenuItem onClick={() => deleteNote(nodeId)}>
            Delete note
          </ResponsiveMenuItem>
        </RowMenu>
      </div>
    </li>
  );
}

function UnfiledSection({
  ids,
  activeRoot,
  open,
  onToggle,
  onOpen,
}: {
  ids: readonly string[];
  activeRoot: string | null;
  open: boolean;
  onToggle: () => void;
  onOpen: (nodeId: string) => void;
}) {
  return (
    <div className="border-t px-2 py-2">
      <button
        type="button"
        className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-muted-foreground hover:bg-sidebar-accent"
        aria-expanded={open}
        onClick={onToggle}
      >
        <HugeiconsIcon
          icon={open ? ArrowDown01Icon : ArrowRight01Icon}
          className="size-3.5 shrink-0"
          aria-hidden="true"
        />
        <HugeiconsIcon
          icon={InboxIcon}
          className="size-4 shrink-0"
          aria-hidden="true"
        />
        <span className="flex-1 truncate">Unfiled</span>
        <span className="text-xs tabular-nums">{ids.length}</span>
      </button>
      {open && (
        <ul aria-label="Unfiled">
          {ids.map((id) => (
            <UnfiledItem
              key={id}
              nodeId={id}
              active={activeRoot === id}
              onOpen={onOpen}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function UnfiledItem({
  nodeId,
  active,
  onOpen,
}: {
  nodeId: string;
  active: boolean;
  onOpen: (nodeId: string) => void;
}) {
  const title = useNoteTitle(nodeId);
  return (
    <li
      draggable
      data-library-node={nodeId}
      onDragStart={(e) => startLibraryDrag(e, { kind: "node", nodeId })}
      style={{ paddingInlineStart: 12 }}
    >
      <SidebarRow
        icon={Note01Icon}
        active={active}
        onClick={() => onOpen(nodeId)}
      >
        {title}
      </SidebarRow>
    </li>
  );
}

// --- small pieces -------------------------------------------------------------

function SidebarRow({
  icon,
  iconComponent: IconComponent,
  active,
  onClick,
  onDoubleClick,
  children,
}: {
  icon?: IconSvgElement;
  iconComponent?: React.ComponentType<{ className?: string }>;
  active: boolean;
  onClick: () => void;
  onDoubleClick?: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={cn(
        "flex w-full min-w-0 items-center gap-1.5 rounded-md px-2 py-1 text-left hover:bg-sidebar-accent",
        active &&
          "bg-sidebar-accent font-medium text-sidebar-accent-foreground",
      )}
      aria-current={active ? "page" : undefined}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
    >
      {icon ? (
        <HugeiconsIcon
          icon={icon}
          className="size-4 shrink-0 text-muted-foreground"
          aria-hidden="true"
        />
      ) : IconComponent ? (
        <IconComponent className="size-4 shrink-0 text-muted-foreground" />
      ) : null}
      <span className="truncate">{children}</span>
    </button>
  );
}

function SidebarIconButton({
  icon,
  label,
  onClick,
}: {
  icon: IconSvgElement;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      <HugeiconsIcon icon={icon} className="size-4" aria-hidden="true" />
    </button>
  );
}

function RowMenu({ label, children }: { label: string; children: ReactNode }) {
  return (
    <ResponsiveMenu title={label}>
      <ResponsiveMenuTrigger
        render={
          <button
            type="button"
            aria-label={label}
            className="absolute right-1 inline-flex size-6 items-center justify-center rounded-md text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-sidebar-accent focus-visible:opacity-100 data-[popup-open]:opacity-100"
          >
            <HugeiconsIcon
              icon={MoreHorizontalIcon}
              className="size-4"
              aria-hidden="true"
            />
          </button>
        }
      />
      <ResponsiveMenuContent align="end">{children}</ResponsiveMenuContent>
    </ResponsiveMenu>
  );
}

function RenameInput({
  initial,
  label,
  onDone,
}: {
  initial: string;
  label: string;
  /** The committed name, or null when cancelled. */
  onDone: (next: string | null) => void;
}) {
  const [value, setValue] = useState(initial);
  const commit = () => onDone(value.trim() ? value : null);
  return (
    <input
      // oxlint-disable-next-line jsx-a11y/no-autofocus -- the rename was just asked for
      autoFocus
      aria-label={label}
      className="mx-1 my-0.5 min-w-0 flex-1 rounded-md border bg-background px-1.5 py-0.5 text-sm outline-none focus:ring-2 focus:ring-ring/50"
      value={value}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setValue(e.currentTarget.value)}
      onBlur={commit}
      onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        } else if (e.key === "Escape") {
          e.preventDefault();
          onDone(null);
        }
      }}
    />
  );
}

function DropLine({ zone }: { zone: DropZone | null }) {
  if (zone !== "before" && zone !== "after") return null;
  return (
    <span
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute inset-x-1 h-0.5 rounded-full bg-primary",
        zone === "before" ? "top-0" : "bottom-0",
      )}
    />
  );
}

/** A note's title: its root node's plain reading text (never its source). */
function useNoteTitle(nodeId: string): string {
  const node = useNode(nodeId);
  return noteTitle(getTreeIndex(), node?.text ?? "");
}

function noteTitle(index: TreeIndex, text: string): string {
  return flattenNodeText(index, text).trim() || "Untitled";
}

// --- library drag and drop --------------------------------------------------

const DRAG_TYPE = "application/x-dotflowy-library";

const LibraryDragSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("row"), id: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("node"), nodeId: Schema.String }),
]);
type LibraryDrag = Schema.Schema.Type<typeof LibraryDragSchema>;
// The drag payload crosses a browser boundary (another tab can drop anything).
const decodeLibraryDrag = Schema.decodeUnknownOption(
  Schema.fromJsonString(LibraryDragSchema),
);

type DropZone = "before" | "after" | "into";

function startLibraryDrag(e: DragEvent, drag: LibraryDrag) {
  e.stopPropagation();
  e.dataTransfer.effectAllowed = "move";
  e.dataTransfer.setData(DRAG_TYPE, JSON.stringify(drag));
}

function hasLibraryDrag(e: DragEvent): boolean {
  return e.dataTransfer.types.includes(DRAG_TYPE);
}

function readLibraryDrag(e: DragEvent): LibraryDrag | null {
  return Option.getOrNull(decodeLibraryDrag(e.dataTransfer.getData(DRAG_TYPE)));
}

/** Where over a row the pointer is: its top or bottom edge places before or
 *  after; the middle of a folder drops into it. */
function zoneFor(e: DragEvent, folder: boolean): DropZone {
  const rect = e.currentTarget.getBoundingClientRect();
  const y = (e.clientY - rect.top) / Math.max(1, rect.height);
  if (folder) return y < 0.25 ? "before" : y > 0.75 ? "after" : "into";
  return y < 0.5 ? "before" : "after";
}

function dropInto(
  drag: LibraryDrag | null,
  rows: readonly LibraryRow[],
  folderId: string | null,
  beforeId: string | null,
) {
  if (!drag) return;
  if (drag.kind === "node") {
    fileNote(drag.nodeId, folderId, beforeId);
    return;
  }
  const row = rows.find((r) => r.id === drag.id);
  if (!row || row.id === beforeId) return;
  // A folder can't move into itself or its own descendants.
  if (row.type === "folder" && isFolderWithin(rows, folderId, row.id)) return;
  moveLibraryRow(row.id, folderId, beforeId);
}

// --- note actions -------------------------------------------------------------

/** Create a top-level node titled "Untitled" and file it in `folderId`. One
 *  undo step removes the node (the library row stays, hidden). */
function createNote(folderId: string | null): string | null {
  const nodeId = runStructural(() => {
    const index = getTreeIndex();
    capture(index, null, null, { label: "create" });
    const top = childrenOf(index, null);
    return insertSibling(
      index,
      null,
      top.length ? top[top.length - 1]!.id : null,
      false,
      "Untitled",
    );
  });
  if (!nodeId) return null;
  fileNote(nodeId, folderId);
  return nodeId;
}

/** Rename a note = edit its root node's text, through the editor's command
 *  funnel (lock guard, text history). */
function renameNote(nodeId: string, text: string) {
  getNodeActionBridge()?.commands.onTextChange(nodeId, text.trim());
}

/** Delete a note = delete its root node's subtree, through the editor's delete
 *  funnel (protection and lock guards, the big-subtree confirm, undo). A tab
 *  showing the note steps back to the whole outline first. */
function deleteNote(nodeId: string) {
  const bridge = getNodeActionBridge();
  if (!bridge) return;
  const tab = getActivePaneTab();
  if (
    tab &&
    tab.rootId !== null &&
    isWithin(getTreeIndex(), tab.rootId, nodeId)
  )
    zoomPane(getActivePaneId(), null);
  bridge.commands.onDeleteNode(nodeId);
}

function isWithin(index: TreeIndex, id: string, ancestorId: string): boolean {
  let cursor: string | null = id;
  let guard = index.byId.size + 1;
  while (cursor !== null && guard-- > 0) {
    if (cursor === ancestorId) return true;
    cursor = index.byId.get(cursor)?.parentId ?? null;
  }
  return false;
}

// --- collapsed folders (per device) ------------------------------------------

const COLLAPSED_KEY = "dotflowy:library-collapsed:v1";
const decodeCollapsed = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Array(Schema.String)),
);
/** The Unfiled section starts collapsed and remembers it like a folder. */
const UNFILED_KEY = "__unfiled__";
const collapsedListeners = new Set<() => void>();
let collapsedSnapshot: ReadonlySet<string> | null = null;

function readCollapsed(): ReadonlySet<string> {
  if (collapsedSnapshot) return collapsedSnapshot;
  let ids: readonly string[] = [UNFILED_KEY];
  try {
    const raw = window.localStorage.getItem(COLLAPSED_KEY);
    if (raw) ids = Option.getOrElse(decodeCollapsed(raw), () => ids);
  } catch {
    // Unreadable storage: everything open except Unfiled.
  }
  collapsedSnapshot = new Set(ids);
  return collapsedSnapshot;
}

function setCollapsed(id: string, next: boolean) {
  const current = readCollapsed();
  if (current.has(id) === next) return;
  const updated = new Set(current);
  if (next) updated.add(id);
  else updated.delete(id);
  collapsedSnapshot = updated;
  try {
    window.localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...updated]));
  } catch {
    // Private mode: the state still holds for this page.
  }
  for (const l of collapsedListeners) l();
}

function subscribeCollapsed(cb: () => void): () => void {
  collapsedListeners.add(cb);
  return () => {
    collapsedListeners.delete(cb);
  };
}

const SERVER_COLLAPSED: ReadonlySet<string> = new Set([UNFILED_KEY]);

function useCollapsedFolders(): ReadonlySet<string> {
  return useSyncExternalStore(
    subscribeCollapsed,
    readCollapsed,
    () => SERVER_COLLAPSED,
  );
}

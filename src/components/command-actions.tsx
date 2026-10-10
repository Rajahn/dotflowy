import {
  ALargeSmallIcon,
  ArrowLeftToLineIcon,
  ArrowRightToLineIcon,
  ArrowBigLeftDashIcon,
  ArrowBigRightDashIcon,
  Columns2Icon,
  PanelLeftIcon,
  PinIcon,
  XIcon,
  BookmarkIcon,
  ChevronsDownUpIcon,
  ChevronsUpDownIcon,
  CircleCheckIcon,
  ClipboardCopyIcon,
  DownloadIcon,
  ExternalLinkIcon,
  FileUpIcon,
  FilterIcon,
  FocusIcon,
  LogOutIcon,
  MessageSquareWarningIcon,
  MonitorIcon,
  MoonIcon,
  PlugZapIcon,
  PlusIcon,
  Undo2Icon,
  Redo2Icon,
  SparklesIcon,
  SunIcon,
} from "lucide-react";
import { useMemo } from "react";

import type { CommandCenterAction } from "../data/command-center";

import { getCommandCenterAmbientRowKey } from "../data/command-bridge";
import { useEditorFeatures } from "../data/editor-features";
import { openFeedbackReport } from "../data/feedback";
import { toggleBookmark } from "../data/mutations";
import { useTree } from "../data/useTree";
import { useIsMobile } from "../hooks/use-mobile";
import { signOutAndReload } from "../lib/auth-client";
import { moveToAdjacentColumn } from "../workbench/column-move-action";
import { useActivePaneRootId } from "../workbench/hooks";
import { MAX_PANES } from "../workbench/model";
import {
  closeActiveTab,
  focusAdjacentPane,
  pinActiveTab,
  splitActivePane,
  toggleSidebar,
  useWorkbenchState,
} from "../workbench/store";
import { openChangelog } from "./changelog-opener";
import {
  copyOutlineAsMarkdown,
  exportOutlineAsOpml,
  setViewCollapsed,
} from "./header-more-menu";
import { restoreHistory, useHistoryState } from "./history-restore";
import { openOpmlImport } from "./opml-import-opener";
import { openFilterInput } from "./query-filter-nav";
import { openQuickAdd } from "./quick-add-opener";
import { useShowCompleted } from "./show-completed-provider";
import { setSpotlightEnabled, useSpotlightEnabled } from "./spotlight-mode";
import { useTextSize, type TextSize } from "./text-size-provider";
import { useTheme } from "./theme-provider";

/**
 * The GLOBAL-scope half of the Cmd+K command center (ADR 0034): the header +
 * More-menu actions re-expressed as flat `CommandCenterAction` rows. A hook, not
 * a module singleton, because it lives INSIDE the provider tree (the switcher is
 * mounted in `__root`, under ThemeProvider et al.) and reads those contexts
 * directly -- no bridge needed for globals.
 *
 * Duplication of the action definitions with `header-more-menu.tsx` is accepted
 * (ADR 0034: an action may live in several surfaces); the two NON-trivial ones
 * (Copy as Markdown, Collapse/Expand all) are reused from that module so their
 * logic isn't forked. Stateful multi-value settings (theme, text size) FLATTEN
 * into discrete rows here (keyboard-discoverable) while the More menu keeps its
 * radio submenus. Bookmark view is contextual -- present only when zoomed.
 */
export function useGlobalActions(opts: {
  openConnect: () => void;
}): CommandCenterAction[] {
  const { openConnect } = opts;
  const { daily } = useEditorFeatures();
  const { theme, setTheme } = useTheme();
  const { textSize, setTextSize } = useTextSize();
  const { showCompleted, setShowCompleted } = useShowCompleted();
  const spotlight = useSpotlightEnabled();
  const { index } = useTree();
  // The active pane's zoom root: Cmd+K acts on the pane that had focus.
  const rootId = useActivePaneRootId();
  const paneCount = useWorkbenchState().panes.length;
  // A phone shows one column (PLAN 1.9): no splitting, no column moves.
  const narrow = useIsMobile();
  const rootNode = rootId ? (index.byId.get(rootId) ?? null) : null;
  const history = useHistoryState();

  return useMemo(() => {
    const a: CommandCenterAction[] = [
      {
        id: "g:undo",
        label: history.undoLabel,
        description: "Undo your last outline edit",
        icon: Undo2Icon,
        scope: "global",
        keywords: ["undo", "history"],
        hotkey: ["⌘", "Z"],
        disabled: !history.canUndo,
        run: () => restoreHistory("undo"),
      },
      {
        id: "g:redo",
        label: history.redoLabel,
        description: "Redo your last undone edit",
        icon: Redo2Icon,
        scope: "global",
        keywords: ["redo", "history"],
        hotkey: ["⌘", "⇧", "Z"],
        disabled: !history.canRedo,
        run: () => restoreHistory("redo"),
      },
      {
        id: "g:quick-add",
        label: "Quick add",
        description: daily
          ? "Capture a thought to Today without leaving where you are"
          : "Capture a thought to the top level without leaving where you are",
        icon: PlusIcon,
        scope: "global",
        keywords: [
          "quick",
          "add",
          "capture",
          "new",
          "inbox",
          "note",
          ...(daily ? ["today"] : []),
        ],
        run: () => openQuickAdd(),
      },
      {
        id: "g:copy-md",
        label: "Copy as Markdown",
        description: "Copy the current view as a markdown list",
        icon: ClipboardCopyIcon,
        scope: "global",
        keywords: ["copy", "markdown", "export", "clipboard"],
        run: () => {
          void copyOutlineAsMarkdown();
        },
      },
      {
        id: "g:import-opml",
        label: "Import OPML…",
        description: "Import a Workflowy OPML export",
        icon: FileUpIcon,
        scope: "global",
        keywords: ["import", "opml", "workflowy", "migrate", "file"],
        run: () => openOpmlImport(),
      },
      {
        id: "g:export-opml",
        label: "Export OPML",
        description: "Download the current view as an OPML file",
        icon: DownloadIcon,
        scope: "global",
        keywords: ["export", "opml", "download", "file", "workflowy", "backup"],
        run: exportOutlineAsOpml,
      },
      {
        id: "g:collapse-all",
        label: "Collapse all",
        description: "Fold every bullet in the current view",
        icon: ChevronsDownUpIcon,
        scope: "global",
        keywords: ["collapse", "fold", "all"],
        run: () => setViewCollapsed(true),
      },
      {
        id: "g:expand-all",
        label: "Expand all",
        description: "Unfold every bullet in the current view",
        icon: ChevronsUpDownIcon,
        scope: "global",
        keywords: ["expand", "unfold", "all"],
        run: () => setViewCollapsed(false),
      },
      {
        id: "g:show-completed",
        label: showCompleted ? "Hide completed" : "Show completed",
        description: "Toggle completed bullets in the view",
        icon: CircleCheckIcon,
        scope: "global",
        keywords: ["completed", "done", "hide", "show", "filter"],
        run: () => setShowCompleted(!showCompleted),
      },
      {
        id: "g:spotlight",
        label: spotlight ? "Turn off spotlight mode" : "Spotlight mode",
        description: "Dim everything but the focused bullet",
        icon: FocusIcon,
        scope: "global",
        keywords: ["spotlight", "focus", "dim", "zen"],
        run: () => setSpotlightEnabled(!spotlight),
      },
      {
        id: "g:filter",
        label: "Filter this view",
        description: "Filter by #tag, is:todo, has:link, text, and more",
        icon: FilterIcon,
        scope: "global",
        keywords: ["filter", "search", "query", "find", "tag", "todo"],
        // The switcher closes first (runAction), releasing focus; the opener
        // defers focus a frame so the input wins the focus race (ADR 0047 §6).
        run: () => openFilterInput(),
      },
      // Workbench layout (docs/workbench/PLAN.md 1.3, 1.5). Every shortcut
      // also lives here, so a chord is never the only way in.
      {
        id: "g:split",
        label: "Split right",
        description:
          paneCount >= MAX_PANES
            ? "At most four columns"
            : "Open this view in a new column to the right",
        icon: Columns2Icon,
        scope: "global",
        keywords: ["split", "column", "pane", "side by side"],
        hotkey: ["⌘", "\\"],
        disabled: narrow || paneCount >= MAX_PANES,
        run: () => void splitActivePane(),
      },
      {
        id: "g:close-tab",
        label: "Close tab",
        description: "Close the active tab",
        icon: XIcon,
        scope: "global",
        keywords: ["close", "tab"],
        run: () => closeActiveTab(),
      },
      {
        id: "g:pin-tab",
        label: "Keep tab open",
        description: "Pin the preview tab so the next note opens beside it",
        icon: PinIcon,
        scope: "global",
        keywords: ["pin", "keep", "preview", "tab"],
        run: () => pinActiveTab(),
      },
      {
        id: "g:pane-left",
        label: "Focus column on the left",
        description: "Move to the column on the left",
        icon: ArrowLeftToLineIcon,
        scope: "global",
        keywords: ["column", "pane", "left", "focus"],
        disabled: narrow || paneCount < 2,
        run: () => focusAdjacentPane(-1),
      },
      {
        id: "g:pane-right",
        label: "Focus column on the right",
        description: "Move to the column on the right",
        icon: ArrowRightToLineIcon,
        scope: "global",
        keywords: ["column", "pane", "right", "focus"],
        disabled: narrow || paneCount < 2,
        run: () => focusAdjacentPane(1),
      },
      {
        id: "g:move-left",
        label: "Move to column on the left",
        description:
          "Move the selection, or the bullet you were on, into the left column",
        icon: ArrowBigLeftDashIcon,
        scope: "global",
        keywords: ["move", "column", "pane", "left", "send"],
        hotkey: ["⌃", "⌥", "←"],
        disabled: narrow || paneCount < 2,
        run: () =>
          void moveToAdjacentColumn(-1, getCommandCenterAmbientRowKey()),
      },
      {
        id: "g:move-right",
        label: "Move to column on the right",
        description:
          "Move the selection, or the bullet you were on, into the right column",
        icon: ArrowBigRightDashIcon,
        scope: "global",
        keywords: ["move", "column", "pane", "right", "send"],
        hotkey: ["⌃", "⌥", "→"],
        disabled: narrow || paneCount < 2,
        run: () =>
          void moveToAdjacentColumn(1, getCommandCenterAmbientRowKey()),
      },
      {
        id: "g:sidebar",
        label: "Toggle sidebar",
        description: "Show or hide the notes sidebar",
        icon: PanelLeftIcon,
        scope: "global",
        keywords: ["sidebar", "notes", "folders", "library"],
        run: () => toggleSidebar(),
      },
    ];

    if (rootNode) {
      const isBookmarked = rootNode.bookmarkedAt != null;
      a.push({
        id: "g:bookmark",
        label: isBookmarked ? "Remove bookmark" : "Bookmark view",
        description: "Save (or unsave) this zoom view",
        icon: BookmarkIcon,
        scope: "global",
        keywords: ["bookmark", "save", "pin", "star"],
        run: () => {
          toggleBookmark(rootNode.id, !isBookmarked);
        },
      });
    }

    const themes: {
      value: "light" | "dark" | "system";
      label: string;
      icon: typeof SunIcon;
    }[] = [
      { value: "light", label: "Light", icon: SunIcon },
      { value: "dark", label: "Dark", icon: MoonIcon },
      { value: "system", label: "System", icon: MonitorIcon },
    ];
    for (const t of themes) {
      a.push({
        id: `g:theme-${t.value}`,
        label: `Theme: ${t.label}`,
        description:
          theme === t.value
            ? "Current theme"
            : `Switch to the ${t.label.toLowerCase()} theme`,
        icon: t.icon,
        scope: "global",
        keywords: [
          "theme",
          "appearance",
          "dark",
          "light",
          t.label.toLowerCase(),
        ],
        run: () => setTheme(t.value),
      });
    }

    const sizes: TextSize[] = ["small", "default", "large"];
    for (const s of sizes) {
      const label = s.charAt(0).toUpperCase() + s.slice(1);
      a.push({
        id: `g:text-${s}`,
        label: `Text size: ${label}`,
        description:
          textSize === s
            ? "Current text size"
            : `Use ${label.toLowerCase()} text`,
        icon: ALargeSmallIcon,
        scope: "global",
        keywords: ["text", "size", "font", "zoom", s],
        run: () => setTextSize(s),
      });
    }

    a.push(
      {
        id: "g:mcp",
        label: "Connect apps (MCP)",
        description: "Connect an AI agent to your outline",
        icon: PlugZapIcon,
        scope: "global",
        keywords: ["mcp", "connect", "apps", "agent", "ai", "claude"],
        run: openConnect,
      },
      {
        id: "g:changelog",
        label: "What's new",
        description: "Every change to Dotflowy, newest first",
        icon: SparklesIcon,
        scope: "global",
        keywords: ["changelog", "release", "version", "news", "updates"],
        run: () => openChangelog(),
      },
      {
        id: "g:feedback",
        label: "Report a bug",
        description: "Open a pre-filled GitHub issue",
        icon: MessageSquareWarningIcon,
        scope: "global",
        keywords: ["feedback", "bug", "report", "issue", "problem", "github"],
        run: () => openFeedbackReport(),
      },
      {
        id: "g:github",
        label: "GitHub",
        description: "Open the dotflowy repository",
        icon: ExternalLinkIcon,
        scope: "global",
        keywords: ["github", "source", "code", "repo"],
        run: () =>
          window.open(
            "https://git.new/dotflowy",
            "_blank",
            "noopener,noreferrer",
          ),
      },
      {
        id: "g:signout",
        label: "Sign out",
        description: "Sign out of your account",
        icon: LogOutIcon,
        scope: "global",
        keywords: ["sign out", "logout", "log out", "exit"],
        run: () => {
          signOutAndReload();
        },
      },
    );

    return a;
  }, [
    history,
    theme,
    setTheme,
    textSize,
    setTextSize,
    showCompleted,
    setShowCompleted,
    spotlight,
    rootNode,
    openConnect,
    daily,
    paneCount,
    narrow,
  ]);
}

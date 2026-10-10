import { SidebarLeftIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useRef, useSyncExternalStore } from "react";

import { MenuDrawerContent } from "../components/menu-drawer";
import { Button } from "../components/ui/button";
import { Drawer } from "../components/ui/drawer";
import { useActivePaneRootId } from "./hooks";
import { usePaneWindowScroll } from "./pane-context";
import { Sidebar } from "./Sidebar";

/**
 * The library on a narrow screen (docs/workbench/PLAN.md 1.9): the sidebar's
 * folders and notes in a bottom drawer (the ADR 0066 presentation), opened
 * from a button at the left of the header. Opening a note closes it. Its open
 * state is per page and separate from the desktop sidebar's saved state, so a
 * phone never rewrites the layout the desktop saved.
 */

let open = false;
const listeners = new Set<() => void>();

function setOpen(next: boolean): void {
  if (open === next) return;
  open = next;
  for (const l of listeners) l();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** Open the library drawer (narrow screens). */
export function openMobileLibrary(): void {
  setOpen(true);
}

/** The header's library button; renders only in a narrow-screen pane. */
export function MobileLibraryButton() {
  if (!usePaneWindowScroll()) return null;
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      className="-ml-2 shrink-0"
      onClick={() => setOpen(true)}
      aria-label="Library"
    >
      <HugeiconsIcon icon={SidebarLeftIcon} aria-hidden="true" />
    </Button>
  );
}

/** The drawer itself, mounted once by the narrow-screen workbench. */
export function MobileLibraryDrawer() {
  const isOpen = useSyncExternalStore(
    subscribe,
    () => open,
    () => false,
  );
  // A note opened from the drawer changes the active view: close it then.
  const root = useActivePaneRootId();
  const shownRoot = useRef(root);
  useEffect(() => {
    if (shownRoot.current === root) return;
    shownRoot.current = root;
    setOpen(false);
  }, [root]);
  // Leaving the narrow layout unmounts the drawer; don't reopen it later.
  useEffect(() => () => setOpen(false), []);

  return (
    <Drawer showSwipeHandle open={isOpen} onOpenChange={setOpen}>
      <MenuDrawerContent title="Library">
        <Sidebar width={0} drawer />
      </MenuDrawerContent>
    </Drawer>
  );
}

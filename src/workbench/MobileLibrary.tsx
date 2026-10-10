import { SidebarLeftIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useSyncExternalStore } from "react";

import { MenuDrawerContent } from "../components/menu-drawer";
import { Button } from "../components/ui/button";
import { Drawer } from "../components/ui/drawer";
import { usePaneWindowScroll } from "./pane-context";
import { Sidebar } from "./Sidebar";

/**
 * The library on a narrow screen (docs/workbench/PLAN.md 1.9): the sidebar's
 * folders and notes in a bottom drawer (the ADR 0066 presentation), opened
 * from a button at the left of the header. A tap that opens a note (a row
 * marked `data-sidebar-open`) closes it, even when that note is already the
 * one showing. Its open
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
      onClick={openMobileLibrary}
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
  // Leaving the narrow layout unmounts the drawer; don't reopen it later.
  useEffect(() => () => setOpen(false), []);

  return (
    <Drawer showSwipeHandle open={isOpen} onOpenChange={setOpen}>
      <MenuDrawerContent
        title="Library"
        onClickCapture={(e) => {
          if (
            e.target instanceof Element &&
            e.target.closest("[data-sidebar-open]")
          )
            setOpen(false);
        }}
      >
        <Sidebar width={0} drawer />
      </MenuDrawerContent>
    </Drawer>
  );
}

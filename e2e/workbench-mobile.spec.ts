import { expect, test, type Page } from "@playwright/test";

import type { LibraryRow } from "../src/data/library-core";

import { openSeededOutline, seedOutline, type SeedNode } from "./fixtures";

// The workbench on a phone (docs/workbench/PLAN.md 1.9): one column, the
// library in a drawer, a sideways tab strip, the move picker's open tabs, and
// the switch across the 768px breakpoint.

const TREE: SeedNode[] = [
  { id: "alpha", parentId: null, prevSiblingId: null, text: "Alpha" },
  { id: "beta", parentId: null, prevSiblingId: "alpha", text: "Beta" },
  { id: "a1", parentId: "alpha", prevSiblingId: null, text: "Alpha one" },
  { id: "b1", parentId: "beta", prevSiblingId: null, text: "Beta one" },
];

const libraryRow = (value: LibraryRow) => ({ key: value.id, value });

async function load(page: Page) {
  await seedOutline(page, TREE, {
    kv: {
      library: [
        libraryRow({
          id: "f-work",
          type: "folder",
          parentId: null,
          rank: "a",
          title: "Work",
        }),
        libraryRow({
          id: "n-alpha",
          type: "note",
          parentId: "f-work",
          rank: "a",
          rootNodeId: "alpha",
        }),
        libraryRow({
          id: "n-beta",
          type: "note",
          parentId: "f-work",
          rank: "b",
          rootNodeId: "beta",
        }),
      ],
    },
  });
  await openSeededOutline(page, { anchorId: "alpha" });
}

const title = (page: Page) => page.locator(".zoomed-title-text");
const drawer = (page: Page) => page.getByRole("dialog", { name: "Library" });

/** Open a note from the library drawer (a preview tab); the drawer closes. */
async function openFromLibrary(page: Page, name: string) {
  await page.getByRole("button", { name: "Library", exact: true }).click();
  const note = drawer(page).getByRole("button", { name, exact: true });
  await expect(note).toBeVisible();
  await note.click();
  await expect(drawer(page)).toBeHidden();
  await expect(title(page)).toHaveText(name);
}

test.describe("workbench on a phone", () => {
  test.use({ viewport: { width: 375, height: 700 } });

  test("library drawer, tab strip, and the move picker's open tabs", async ({
    page,
  }) => {
    await load(page);
    // One column, no desktop sidebar or tab strip.
    await expect(page.locator("section[data-pane-id]")).toHaveCount(0);
    await expect(page.locator(".workbench-sidebar")).toHaveCount(0);
    await expect(page.getByRole("tablist")).toHaveCount(0);

    await openFromLibrary(page, "Alpha");
    // An edit keeps the preview open, so the next note opens beside it.
    const a1 = page.locator('li[data-node-id="a1"] .node-text').first();
    await a1.click();
    await page.keyboard.press("End");
    await page.keyboard.type("x");
    await page.keyboard.press("Backspace");
    await openFromLibrary(page, "Beta");

    // Tabs: the strip appears, and switching tabs switches the view.
    const tabs = page.getByRole("tablist");
    await expect(tabs.getByRole("tab", { name: "Beta" })).toBeVisible();
    await tabs.getByRole("tab", { name: "Alpha" }).click();
    await expect(title(page)).toHaveText("Alpha");
    await expect(page).toHaveURL(/\/alpha/);

    // Move a bullet to the other open tab through the picker.
    await a1.click();
    await page.keyboard.press("End");
    await page.keyboard.type(" /move");
    await page.keyboard.press("Enter");
    const picker = page.getByRole("dialog", { name: "Move node" });
    await expect(picker).toBeVisible();
    await expect(picker.locator("[cmdk-group-heading]").first()).toHaveText(
      "Open tabs",
    );
    await picker.getByRole("option", { name: /^Beta/ }).first().click();
    await expect(page.locator('li[data-node-id="a1"]')).toHaveCount(0);

    await tabs.getByRole("tab", { name: "Beta" }).click();
    await expect(page.locator('li[data-node-id="a1"]')).toHaveCount(1);
  });

  test("a two-column layout shows its active column on a phone and comes back at 768px", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await load(page);
    const library = page.getByRole("navigation", { name: "Library" });
    await library
      .getByRole("button", { name: "Alpha", exact: true })
      .dblclick();
    await page.keyboard.press("ControlOrMeta+\\");
    await library.getByRole("button", { name: "Beta", exact: true }).dblclick();
    await expect(page.locator("section[data-pane-id]")).toHaveCount(2);

    // 767px: only the active (right) column, on page scroll.
    await page.setViewportSize({ width: 767, height: 800 });
    await expect(page.locator("section[data-pane-id]")).toHaveCount(0);
    await expect(page.locator("main[data-pane-id]")).toHaveCount(1);
    await expect(title(page)).toHaveText("Beta");
    await expect(page.locator("[data-pane-scroll]")).toHaveCount(0);

    // 768px: both columns again, as they were.
    await page.setViewportSize({ width: 768, height: 800 });
    await expect(page.locator("section[data-pane-id]")).toHaveCount(2);
    await expect(
      page
        .locator("section[data-pane-id]")
        .nth(0)
        .locator(".zoomed-title-text"),
    ).toHaveText("Alpha");
    await expect(
      page
        .locator("section[data-pane-id]")
        .nth(1)
        .locator(".zoomed-title-text"),
    ).toHaveText("Beta");
  });
});

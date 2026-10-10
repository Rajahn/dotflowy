import { expect, test, type Page } from "@playwright/test";

import type { LibraryRow } from "../src/data/library-core";

import { openSeededOutline, seedOutline, type SeedNode } from "./fixtures";

// Moving bullets between workbench columns from the keyboard
// (docs/workbench/PLAN.md 1.5): Ctrl+Alt+Left/Right, where the caret lands,
// one undo, and the move dialog's open-tab targets.

const TREE: SeedNode[] = [
  { id: "alpha", parentId: null, prevSiblingId: null, text: "Alpha" },
  { id: "beta", parentId: null, prevSiblingId: "alpha", text: "Beta" },
  { id: "a1", parentId: "alpha", prevSiblingId: null, text: "Alpha one" },
  { id: "a2", parentId: "alpha", prevSiblingId: "a1", text: "Alpha two" },
  { id: "a3", parentId: "alpha", prevSiblingId: "a2", text: "Alpha three" },
  { id: "b1", parentId: "beta", prevSiblingId: null, text: "Beta one" },
  { id: "b2", parentId: "beta", prevSiblingId: "b1", text: "Beta two" },
];

const libraryRow = (value: LibraryRow) => ({ key: value.id, value });

const column = (page: Page, i: number) =>
  page.locator("section[data-pane-id]").nth(i);
const text = (page: Page, i: number, id: string) =>
  column(page, i).locator(`li[data-node-id="${id}"] > .outline-row .node-text`);

/** A column's mounted rows in flat-list order. */
const order = (page: Page, i: number) =>
  column(page, i)
    .locator("li[data-node-id]")
    .evaluateAll((els) =>
      els
        .flatMap((el) =>
          el instanceof HTMLElement
            ? [{ index: Number(el.dataset.index), id: el.dataset.nodeId }]
            : [],
        )
        .sort((a, b) => a.index - b.index)
        .map((r) => r.id),
    );

/** Alpha in the left column, Beta in a new right column. */
async function load(page: Page) {
  await seedOutline(page, TREE, {
    kv: {
      library: [
        libraryRow({
          id: "n-alpha",
          type: "note",
          parentId: null,
          rank: "a",
          rootNodeId: "alpha",
        }),
        libraryRow({
          id: "n-beta",
          type: "note",
          parentId: null,
          rank: "b",
          rootNodeId: "beta",
        }),
      ],
    },
  });
  await openSeededOutline(page, { anchorId: "alpha" });
  const library = page.getByRole("navigation", { name: "Library" });
  await library.getByRole("button", { name: "Alpha", exact: true }).dblclick();
  await page.keyboard.press("ControlOrMeta+\\");
  await library.getByRole("button", { name: "Beta", exact: true }).click();
  await expect(column(page, 1).locator(".zoomed-title-text")).toHaveText(
    "Beta",
  );
  await expect(column(page, 0).locator(".zoomed-title-text")).toHaveText(
    "Alpha",
  );
}

test("Ctrl+Alt+Right moves a bullet after the other column's caret row; one undo restores it", async ({
  page,
}) => {
  await load(page);
  // The right column last had the caret in "Beta one".
  await text(page, 1, "b1").click();
  await expect(text(page, 1, "b1")).toBeFocused();

  await text(page, 0, "a2").click();
  await expect(text(page, 0, "a2")).toBeFocused();
  await page.keyboard.press("Control+Alt+ArrowRight");

  await expect.poll(() => order(page, 1)).toEqual(["b1", "a2", "b2"]);
  await expect.poll(() => order(page, 0)).toEqual(["a1", "a3"]);
  // The caret stays in the source column, on the row after the moved one.
  await expect(text(page, 0, "a3")).toBeFocused();
  // The landed row flashes in the target column.
  await expect(
    column(page, 1).locator('li[data-node-id="a2"] > .outline-row'),
  ).toHaveClass(/node-acted/);

  // A second move from the last row lands after the first one, and the caret
  // falls back to the row above.
  await page.keyboard.press("Control+Alt+ArrowRight");
  await expect.poll(() => order(page, 1)).toEqual(["b1", "a2", "a3", "b2"]);
  await expect(text(page, 0, "a1")).toBeFocused();

  // Each move is one undo step, back into the left column.
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => order(page, 0)).toEqual(["a1", "a3"]);
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => order(page, 0)).toEqual(["a1", "a2", "a3"]);
  await expect.poll(() => order(page, 1)).toEqual(["b1", "b2"]);

  // No column further right: the chord does nothing.
  await text(page, 1, "b2").click();
  await page.keyboard.press("Control+Alt+ArrowRight");
  await expect.poll(() => order(page, 1)).toEqual(["b1", "b2"]);
});

test("a selection moves whole with Ctrl+Alt+Left, to the end when the column has no caret row", async ({
  page,
}) => {
  await load(page);
  // Focus the left column on its title, so it has no remembered row.
  await column(page, 0).locator(".zoomed-title-text").click();

  await text(page, 1, "b1").click();
  await page.keyboard.press("End");
  await page.keyboard.press("Shift+ArrowDown");
  await page.keyboard.press("Shift+ArrowDown");
  await expect(
    column(page, 1).locator('li[data-node-id="b2"]'),
  ).toHaveAttribute("data-selected", "bottom");
  await page.keyboard.press("Control+Alt+ArrowLeft");

  await expect
    .poll(() => order(page, 0))
    .toEqual(["a1", "a2", "a3", "b1", "b2"]);
  await expect.poll(() => order(page, 1)).toEqual([]);
  // Nothing left in the source: the caret goes to its title.
  await expect(column(page, 1).locator(".zoomed-title-text")).toBeFocused();

  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => order(page, 1)).toEqual(["b1", "b2"]);
  await expect.poll(() => order(page, 0)).toEqual(["a1", "a2", "a3"]);
});

test("the move dialog lists open tabs first", async ({ page }) => {
  await load(page);
  await text(page, 0, "a1").click();
  await page.keyboard.press("End");
  await page.keyboard.type(" /move");
  await expect(page.getByRole("listbox")).toBeVisible();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  const groups = dialog.locator("[cmdk-group-heading]");
  await expect(groups.first()).toHaveText("Open tabs");
  await dialog.getByRole("option", { name: /^Beta/ }).first().click();

  await expect.poll(() => order(page, 1)).toEqual(["b1", "b2", "a1"]);
  await expect.poll(() => order(page, 0)).toEqual(["a2", "a3"]);
});

import { expect, test, type Page } from "@playwright/test";

import type { LibraryRow } from "../src/data/library-core";

import { openSeededOutline, seedOutline, type SeedNode } from "./fixtures";

// Dragging bullets across workbench columns (docs/workbench/PLAN.md 1.4):
// move, Alt-copy, tab hover, tab strip, sidebar targets, Escape. Every locator
// is scoped to a column; the same node can show in both.

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
        libraryRow({
          id: "f-archive",
          type: "folder",
          parentId: null,
          rank: "c",
          title: "Archive",
        }),
      ],
    },
  });
  await openSeededOutline(page, { anchorId: "alpha" });
}

const sidebar = (page: Page) =>
  page.getByRole("navigation", { name: "Library" });
const column = (page: Page, i: number) =>
  page.locator("section[data-pane-id]").nth(i);
const row = (page: Page, i: number, id: string) =>
  column(page, i).locator(`li[data-node-id="${id}"]`);

/** Press a bullet, travel in steps to (x, y), and leave the button down. */
async function dragBullet(
  page: Page,
  col: number,
  id: string,
  x: number,
  y: number,
) {
  const box = (await row(page, col, id).locator(".bullet").boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 12, box.y + 12, { steps: 3 });
  await page.mouse.move(x, y, { steps: 12 });
}

test("move and copy across columns, one undo each; tab, strip and sidebar targets", async ({
  page,
}) => {
  await load(page);
  // Alpha in the left column, Beta in a new right column.
  await sidebar(page)
    .getByRole("button", { name: "Alpha", exact: true })
    .dblclick();
  await page.keyboard.press("ControlOrMeta+\\");
  await sidebar(page)
    .getByRole("button", { name: "Beta", exact: true })
    .click();
  await expect(column(page, 1).locator(".zoomed-title-text")).toHaveText(
    "Beta",
  );
  await expect(column(page, 0).locator(".zoomed-title-text")).toHaveText(
    "Alpha",
  );

  // Move "Alpha one" into the right column, between Beta one and Beta two.
  const b2 = (await row(page, 1, "b2").boundingBox())!;
  // At the row's left edge: depth 0 there, a sibling (right of it by more
  // than an indent would nest under the row above).
  await dragBullet(page, 0, "a1", b2.x + 4, b2.y + 2);
  await expect(page.locator(".drag-indicator")).toBeVisible();
  await page.mouse.up();
  await expect(row(page, 1, "a1")).toHaveAttribute("data-parent-id", "beta");
  // A column's mounted rows in flat-list order.
  const order = (i: number) =>
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
  await expect.poll(() => order(1)).toEqual(["b1", "a1", "b2"]);
  await expect(row(page, 0, "a1")).toHaveCount(0);

  // One undo puts it back in both columns.
  await page.keyboard.press("ControlOrMeta+z");
  await expect(row(page, 0, "a1")).toBeVisible();
  await expect(row(page, 1, "a1")).toHaveCount(0);

  // Alt-drag copies: the original stays, a copy lands under Beta two.
  const b2Again = (await row(page, 1, "b2").boundingBox())!;
  await page.keyboard.down("Alt");
  await dragBullet(
    page,
    0,
    "a2",
    b2Again.x + 4,
    b2Again.y + b2Again.height + 4,
  );
  await expect(page.locator(".drag-pill[data-copy]")).toBeVisible();
  await page.mouse.up();
  await page.keyboard.up("Alt");
  await expect(column(page, 1).getByText("Alpha two")).toBeVisible();
  await expect(row(page, 0, "a2")).toBeVisible();
  await page.keyboard.press("ControlOrMeta+z");
  await expect(column(page, 1).getByText("Alpha two")).toHaveCount(0);
  // Let the undo's focus landing finish before the next gesture starts.
  await expect(page.locator(".node-text:focus")).toHaveCount(1);

  // Resting on the right column's other tab switches it; Escape cancels.
  const alphaTab = column(page, 1).getByRole("tab", {
    name: "Alpha",
    exact: true,
  });
  const tabBox = (await alphaTab.boundingBox())!;
  await dragBullet(
    page,
    0,
    "a3",
    tabBox.x + tabBox.width / 2,
    tabBox.y + tabBox.height / 2,
  );
  await expect(alphaTab).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(page.locator(".drag-pill")).toHaveCount(0);
  await expect(row(page, 0, "a3")).toHaveAttribute("data-parent-id", "alpha");

  // Dropping on a tab strip's empty space opens the node in a new tab there.
  const strip = (await column(page, 1).getByRole("tablist").boundingBox())!;
  await dragBullet(
    page,
    0,
    "a3",
    strip.x + strip.width - 20,
    strip.y + strip.height / 2,
  );
  await page.mouse.up();
  await expect(
    column(page, 1).getByRole("tab", { name: "Alpha three", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(row(page, 0, "a3")).toBeVisible();

  // A sidebar note takes the node as its last child.
  const betaNote = (await sidebar(page)
    .getByRole("button", { name: "Beta", exact: true })
    .boundingBox())!;
  await dragBullet(
    page,
    0,
    "a3",
    betaNote.x + 20,
    betaNote.y + betaNote.height / 2,
  );
  await page.mouse.up();
  await expect(row(page, 0, "a3")).toHaveCount(0);
  await column(page, 1).getByRole("tab", { name: "Beta", exact: true }).click();
  await expect.poll(() => order(1)).toEqual(["b1", "b2", "a3"]);

  // A sidebar folder makes it a top-level note filed there.
  const folder = (await sidebar(page)
    .getByRole("button", { name: "Archive", exact: true })
    .boundingBox())!;
  await dragBullet(page, 1, "a3", folder.x + 30, folder.y + folder.height / 2);
  await page.mouse.up();
  const archive = sidebar(page)
    .getByRole("button", { name: "Archive", exact: true })
    .locator("xpath=ancestor::li[1]");
  await expect(
    archive.getByRole("button", { name: "Alpha three", exact: true }),
  ).toBeVisible();
  await expect(row(page, 1, "a3")).toHaveCount(0);
});

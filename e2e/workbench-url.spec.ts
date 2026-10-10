import { expect, test, type Page } from "@playwright/test";

import { openSeededOutline, seedOutline, type SeedNode } from "./fixtures";

// The URL as a projection of the active tab (ADR 0069): a filter survives a
// reload exactly as typed, and browser back/forward land the caret the way a
// zoom out / in does.

const MOD = process.platform === "darwin" ? "Meta" : "Control";

const TREE: SeedNode[] = [
  { id: "p", parentId: null, prevSiblingId: null, text: "alpha beta" },
  { id: "q", parentId: null, prevSiblingId: "p", text: "beta alpha" },
  { id: "c1", parentId: "p", prevSiblingId: null, text: "child one" },
];

const text = (page: Page, id: string) =>
  page.locator(`li[data-node-id="${id}"] > .outline-row .node-text`);

test("a quoted phrase filter reads back unchanged after a reload", async ({
  page,
}) => {
  await seedOutline(page, TREE);
  // The router JSON-encodes a value that starts with a quote.
  const url = `/?q=${encodeURIComponent(JSON.stringify('"alpha beta"'))}`;
  await openSeededOutline(page, { path: url, anchorId: "p" });
  const filter = page.getByRole("textbox", { name: "Filter query" });
  await expect(filter).toHaveValue('"alpha beta"');
  await expect(text(page, "q")).toHaveCount(0);

  await page.reload();
  await expect(text(page, "p")).toBeVisible();
  await expect(filter).toHaveValue('"alpha beta"');
  await expect(text(page, "q")).toHaveCount(0);
  expect(new URL(page.url()).search).toBe(new URL(url, page.url()).search);
});

test("browser back lands on the node you came out of, forward on its first child", async ({
  page,
}) => {
  await seedOutline(page, TREE);
  await openSeededOutline(page, { anchorId: "p" });
  await text(page, "p").click();
  await page.keyboard.press(`${MOD}+.`);
  await expect(page).toHaveURL(/\/p$/);
  await expect(text(page, "c1")).toBeFocused();

  await page.goBack();
  await expect(page).toHaveURL(/\/$/);
  await expect(text(page, "p")).toBeFocused();

  await page.goForward();
  await expect(page).toHaveURL(/\/p$/);
  await expect(text(page, "c1")).toBeFocused();
});

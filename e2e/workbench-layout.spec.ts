import { expect, test, type Page } from "@playwright/test";

import { openSeededOutline, seedOutline, type SeedNode } from "./fixtures";

// Multi-column layout and tabs (docs/workbench/PLAN.md 1.3, 1.8). Every locator
// is scoped to a pane: one node can render in two columns at once.

const TREE: SeedNode[] = [
  { id: "alpha", parentId: null, prevSiblingId: null, text: "Alpha" },
  { id: "beta", parentId: null, prevSiblingId: "alpha", text: "Beta" },
  { id: "gamma", parentId: null, prevSiblingId: "beta", text: "Gamma" },
  { id: "a1", parentId: "alpha", prevSiblingId: null, text: "Alpha child" },
];

const note = (id: string, rank: string, rootNodeId: string) => ({
  key: id,
  value: { id, type: "note", parentId: null, rank, rootNodeId },
});

async function load(page: Page) {
  await seedOutline(page, TREE, {
    kv: {
      library: [
        note("n-alpha", "a", "alpha"),
        note("n-beta", "b", "beta"),
        note("n-gamma", "c", "gamma"),
      ],
    },
  });
  await openSeededOutline(page, { anchorId: "alpha" });
}

const sidebar = (page: Page) =>
  page.getByRole("navigation", { name: "Library" });
const noteLink = (page: Page, name: string) =>
  sidebar(page).getByRole("button", { name, exact: true });
const columns = (page: Page) => page.locator("section[data-pane-id]");
const column = (page: Page, i: number) => columns(page).nth(i);
const tabs = (page: Page, i: number) => column(page, i).getByRole("tab");
const title = (page: Page, i: number) =>
  column(page, i).locator(".zoomed-title-text");

test("preview tabs, pinning, splitting to four columns, closing, restore", async ({
  page,
}, info) => {
  await load(page);
  // One pane with one tab shows no tab strip at all.
  await expect(page.getByRole("tablist")).toHaveCount(0);

  // A click previews; the next click replaces the preview.
  await noteLink(page, "Alpha").click();
  await expect(title(page, 0)).toHaveText("Alpha");
  await expect(tabs(page, 0)).toHaveText(["Whole outline", "Alpha"]);
  await expect(tabs(page, 0).nth(1)).toHaveAttribute("data-preview", "");
  await noteLink(page, "Beta").click();
  await expect(tabs(page, 0)).toHaveText(["Whole outline", "Beta"]);
  await page.screenshot({ path: info.outputPath("preview-tab.png") });

  // Double-clicking the tab keeps it; the next preview opens beside it.
  await tabs(page, 0).nth(1).dblclick();
  await expect(tabs(page, 0).nth(1)).not.toHaveAttribute("data-preview", "");
  await noteLink(page, "Gamma").click();
  await expect(tabs(page, 0)).toHaveText(["Whole outline", "Beta", "Gamma"]);
  // Zooming inside a preview doesn't keep it; writing into it does.
  await expect(tabs(page, 0).nth(2)).toHaveAttribute("data-preview", "");
  await title(page, 0).click();
  await page.keyboard.press("End");
  await page.keyboard.type("!");
  await expect(title(page, 0)).toHaveText("Gamma!");
  await expect(tabs(page, 0).nth(2)).not.toHaveAttribute("data-preview", "");

  // Split: a second column with the same view; typing in one shows in both.
  await column(page, 0)
    .getByRole("button", { name: "Split right", exact: true })
    .click();
  await expect(columns(page)).toHaveCount(2);
  await expect(title(page, 1)).toHaveText("Gamma!");
  await title(page, 0).click();
  await page.keyboard.press("End");
  await page.keyboard.type("?");
  await expect(title(page, 1)).toHaveText("Gamma!?");
  await page.screenshot({ path: info.outputPath("two-columns.png") });

  // Up to four columns, then the split control is disabled.
  await column(page, 1)
    .getByRole("button", { name: "Split right", exact: true })
    .click();
  await column(page, 2)
    .getByRole("button", { name: "Split right", exact: true })
    .click();
  await expect(columns(page)).toHaveCount(4);
  for (let i = 0; i < 4; i++)
    await expect(
      column(page, i).getByRole("button", { name: "Split right", exact: true }),
    ).toBeDisabled();

  // Closing a column's last tab closes the column.
  await column(page, 3)
    .getByRole("button", { name: "Close Gamma!?", exact: true })
    .click();
  await expect(columns(page)).toHaveCount(3);

  // The layout comes back after a reload (once its save has landed).
  await page.waitForFunction(() =>
    Object.keys(localStorage).some((k) =>
      k.startsWith("dotflowy:workbench-layout:v1:"),
    ),
  );
  await expect
    .poll(() =>
      page.evaluate(() => {
        const key = Object.keys(localStorage).find((k) =>
          k.startsWith("dotflowy:workbench-layout:v1:"),
        )!;
        return JSON.parse(localStorage.getItem(key)!).panes.length;
      }),
    )
    .toBe(3);
  await page.reload();
  await expect(columns(page)).toHaveCount(3);
  await expect(tabs(page, 0)).toHaveText(["Whole outline", "Beta", "Gamma!?"]);
  await expect(title(page, 2)).toHaveText("Gamma!?");

  // Closing every tab of the last column leaves the empty state.
  for (const i of [2, 1]) {
    await column(page, i)
      .getByRole("button", { name: "Close Gamma!?", exact: true })
      .click();
  }
  await expect(columns(page)).toHaveCount(1);
  for (const name of ["Gamma!?", "Beta"])
    await column(page, 0)
      .getByRole("button", { name: `Close ${name}` })
      .click();
  // A lone tab has no strip; close it from the command center.
  await expect(page.getByRole("tablist")).toHaveCount(0);
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByPlaceholder(/Search nodes and actions/).fill("Close tab");
  await page.getByRole("option", { name: /Close tab/ }).click();
  await expect(
    column(page, 0).getByText("Open a note from the sidebar."),
  ).toBeVisible();
  await page.screenshot({ path: info.outputPath("empty-pane.png") });
  // Its recent list reopens a note.
  await column(page, 0)
    .getByRole("button", { name: "Gamma!?", exact: true })
    .click();
  await expect(title(page, 0)).toHaveText("Gamma!?");
});

test("column widths drag, reset, and scroll sideways when the window is narrow", async ({
  page,
}) => {
  await load(page);
  await page.keyboard.press("ControlOrMeta+\\");
  await expect(columns(page)).toHaveCount(2);

  const widths = () =>
    columns(page).evaluateAll((els) =>
      els.map((el) => Math.round(el.getBoundingClientRect().width)),
    );
  const [left, right] = await widths();
  expect(Math.abs(left! - right!)).toBeLessThan(4);

  // Drag the bar between the columns 120px to the right.
  const bar = page.getByRole("separator", { name: "Resize columns" });
  const box = (await bar.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + 200);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 120, box.y + 200, { steps: 6 });
  await page.mouse.up();
  const [wider, narrower] = await widths();
  expect(wider! - left!).toBeGreaterThan(100);
  expect(right! - narrower!).toBeGreaterThan(100);

  // Double-click restores equal widths.
  await bar.dblclick();
  await expect
    .poll(async () => {
      const [a, b] = await widths();
      return Math.abs(a! - b!);
    })
    .toBeLessThan(4);

  // Three columns of at least 280px can't fit beside the sidebar at 900px:
  // the columns scroll sideways instead of squashing.
  await page.keyboard.press("ControlOrMeta+\\");
  await expect(columns(page)).toHaveCount(3);
  await page.setViewportSize({ width: 900, height: 700 });
  const strip = page.locator("[data-workbench-panes]");
  await expect
    .poll(() => strip.evaluate((el) => el.scrollWidth - el.clientWidth))
    .toBeGreaterThan(0);
  for (const w of await widths()) expect(w).toBeGreaterThanOrEqual(280);
});

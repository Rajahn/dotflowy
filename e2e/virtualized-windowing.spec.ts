import { expect, test, type Page } from "@playwright/test";

import { scrollOutlineTo, seedOutline, type SeedNode } from "./fixtures";

// ADR 0019: the windowed render mounts only ~viewport rows, regardless of how
// many nodes exist. These specs prove the DOM row count stays bounded as the
// outline grows to thousands of nodes -- the whole point of the virtualization,
// which the behavioral suite doesn't directly assert.

// 40 parents x 50 children = 2040 nodes, all expanded -- two depths so the
// screenshot shows real indentation, and far more rows than any viewport holds.
function bigTree(): SeedNode[] {
  const nodes: SeedNode[] = [];
  let prevTop: string | null = null;
  for (let p = 0; p < 40; p++) {
    const pid = `p${p}`;
    nodes.push({
      id: pid,
      parentId: null,
      prevSiblingId: prevTop,
      text: `Parent ${p}`,
    });
    prevTop = pid;
    let prevChild: string | null = null;
    for (let c = 0; c < 50; c++) {
      const cid = `p${p}c${c}`;
      nodes.push({
        id: cid,
        parentId: pid,
        prevSiblingId: prevChild,
        text: `Item ${p}.${c}`,
      });
      prevChild = cid;
    }
  }
  return nodes;
}

const rowCount = (page: Page) => page.locator("li[data-node-id]").count();

async function loadBig(page: Page) {
  await seedOutline(page, bigTree());
  await page.goto("/");
  await expect(
    page.locator('li[data-node-id="p0"] > .outline-row .node-text'),
  ).toBeVisible();
}

test.describe("virtualized windowing (ADR 0019)", () => {
  test("renders only ~viewport rows out of thousands", async ({ page }) => {
    await loadBig(page);

    // 2040 nodes exist, but only a viewport's worth (+ overscan) are mounted.
    // Generous ceiling: a tall viewport at ~32px/row is well under 100 rows.
    const mounted = await rowCount(page);
    expect(mounted).toBeGreaterThan(5);
    expect(mounted).toBeLessThan(100);

    // A node deep in the list is NOT mounted yet (it's below the window).
    await expect(page.locator('li[data-node-id="p39c49"]')).toHaveCount(0);
  });

  test("the window follows the scroll, caret nav and drag cross its edge", async ({
    page,
  }) => {
    await loadBig(page);
    await expect(page.locator('li[data-node-id="p0"]')).toBeVisible();

    // Scroll deep into the list and wait for the window to SETTLE there: a row
    // far down the flat order is mounted AND the top row (p0) is gone, read in
    // one atomic snapshot (dynamic measurement briefly nudges scroll as rows
    // settle, so two separate reads could race). This is the "the window follows
    // the scroll" property -- asserting a deep index rather than the literal last
    // leaf, which estimate-based sizing makes finicky to hit by scrolling.
    await scrollOutlineTo(page, 20000);
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const lis = Array.from(
              document.querySelectorAll<HTMLElement>("li[data-node-id]"),
            );
            const maxIdx = Math.max(
              0,
              ...lis.map((l) => Number(l.dataset.index) || 0),
            );
            const hasTop = lis.some((l) => l.dataset.nodeId === "p0");
            return maxIdx > 300 && !hasTop && lis.length < 100;
          }),
        { timeout: 8000 },
      )
      .toBe(true);

    // Scroll back to the top: the first node mounts again.
    await scrollOutlineTo(page, 0);
    await expect(page.locator('li[data-node-id="p0"]')).toBeVisible();

    // Caret nav walks off the bottom of the mounted window: 60 rows down from
    // the top (p0 + its 50 children + p1 + 8 more) is p1c8, which was not
    // mounted at the start. The outline scrolls to keep the caret on screen.
    await expect(page.locator('li[data-node-id="p1c8"]')).toHaveCount(0);
    const first = page.locator(
      'li[data-node-id="p0"] > .outline-row .node-text',
    );
    await first.click();
    for (let i = 0; i < 60; i++) await page.keyboard.press("ArrowDown");
    const deep = page.locator(
      'li[data-node-id="p1c8"] > .outline-row .node-text',
    );
    await expect(deep).toBeFocused();
    await expect(deep).toBeInViewport();
    // And back up past the top of the window, to the first row.
    for (let i = 0; i < 60; i++) await page.keyboard.press("ArrowUp");
    await expect(first).toBeFocused();
    await expect(first).toBeInViewport();

    // Dragging a bullet to the bottom edge auto-scrolls the outline, so a drop
    // target far below the fold becomes reachable.
    const bullet = page.locator('li[data-node-id="p0c1"] .bullet');
    const from = await bullet.boundingBox();
    if (!from) throw new Error("no bullet box");
    const viewport = page.viewportSize()!;
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x + 10, from.y + 10, { steps: 3 });
    await page.mouse.move(from.x + 10, viewport.height - 4, { steps: 10 });
    // Hold at the edge until rows far below the start have scrolled in.
    await expect(page.locator('li[data-node-id="p3"]')).toBeVisible({
      timeout: 10_000,
    });
    await page.mouse.up();
    // The dragged node left its old slot near the top of the list.
    await expect
      .poll(() =>
        page
          .locator('li[data-node-id="p0c1"]')
          .getAttribute("data-index")
          .then(Number),
      )
      .toBeGreaterThan(100);
  });

  test("a deep node still indents by depth", async ({ page }) => {
    await loadBig(page);
    // Children render one level in (data-depth = 1); parents at depth 0.
    await expect(page.locator('li[data-node-id="p0"]')).toHaveAttribute(
      "data-depth",
      "0",
    );
    await expect(page.locator('li[data-node-id="p0c0"]')).toHaveAttribute(
      "data-depth",
      "1",
    );
  });
});

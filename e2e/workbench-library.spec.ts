import { expect, test, type Page } from "@playwright/test";

import { openSeededOutline, seedOutline } from "./fixtures";

// The workbench sidebar's library (docs/workbench/PLAN.md 1.2, ADR 0070):
// folders and notes over top-level nodes, plus the virtual Unfiled folder.

const sidebar = (page: Page) =>
  page.getByRole("navigation", { name: "Library" });
const item = (page: Page, name: string) =>
  sidebar(page).getByRole("button", { name, exact: true });
/** The `<li>` that holds a sidebar row (a folder's holds its children too). */
const itemLi = (page: Page, name: string) =>
  item(page, name).locator("xpath=ancestor::li[1]");

async function menu(page: Page, name: string, action: string) {
  await item(page, name).hover();
  await sidebar(page)
    .getByRole("button", { name: `${name} options` })
    .click();
  await page.getByRole("menuitem", { name: action }).click();
}

test("folders, notes, renames, moves, filing and deletion", async ({
  page,
}) => {
  await seedOutline(page, [
    { id: "inbox", parentId: null, prevSiblingId: null, text: "Inbox" },
    { id: "plans", parentId: null, prevSiblingId: "inbox", text: "Plans" },
  ]);
  await openSeededOutline(page, { anchorId: "inbox" });

  // A new folder opens straight into its rename field.
  await sidebar(page).getByRole("button", { name: "New folder" }).click();
  const folderName = sidebar(page).getByRole("textbox", {
    name: "Folder name",
  });
  await folderName.fill("Projects");
  await folderName.press("Enter");
  await expect(item(page, "Projects")).toBeVisible();

  // Selecting the folder makes it the home for a new note, which opens in the
  // pane with its "Untitled" title selected for naming.
  await item(page, "Projects").click();
  await sidebar(page).getByRole("button", { name: "New note" }).click();
  const title = page.locator(".zoomed-title-text");
  await expect(title).toHaveText("Untitled");
  await expect(title).toBeFocused();
  await page.keyboard.type("Roadmap");
  await expect(title).toHaveText("Roadmap");
  await expect(
    itemLi(page, "Projects").getByRole("button", {
      name: "Roadmap",
      exact: true,
    }),
  ).toBeVisible();

  // Renaming a note renames its root node.
  await menu(page, "Roadmap", "Rename");
  const noteName = sidebar(page).getByRole("textbox", { name: "Note name" });
  await noteName.fill("Roadmap 2026");
  await noteName.press("Enter");
  await expect(title).toHaveText("Roadmap 2026");

  // A second folder at the root ("Whole outline" resets where new items go),
  // then drag the note into it.
  await item(page, "Whole outline").click();
  await expect(page.locator('li[data-node-id="inbox"]')).toBeVisible();
  await sidebar(page).getByRole("button", { name: "New folder" }).click();
  await folderName.fill("Archive");
  await folderName.press("Enter");
  await item(page, "Roadmap 2026").dragTo(item(page, "Archive"));
  await expect(
    itemLi(page, "Archive").getByRole("button", {
      name: "Roadmap 2026",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    itemLi(page, "Projects").getByRole("button", {
      name: "Roadmap 2026",
      exact: true,
    }),
  ).toHaveCount(0);

  // Unfiled lists the top-level nodes no note opens; dragging one into a
  // folder files it as a note there.
  await sidebar(page)
    .getByRole("button", { name: /Unfiled/ })
    .click();
  const unfiled = sidebar(page).getByRole("list", { name: "Unfiled" });
  await expect(unfiled.getByRole("button")).toHaveText(["Inbox", "Plans"]);
  await unfiled
    .getByRole("button", { name: "Inbox", exact: true })
    .dragTo(item(page, "Projects"));
  await expect(
    itemLi(page, "Projects").getByRole("button", {
      name: "Inbox",
      exact: true,
    }),
  ).toBeVisible();
  await expect(unfiled.getByRole("button")).toHaveText(["Plans"]);
  // Opening a note shows its outline.
  await itemLi(page, "Projects")
    .getByRole("button", { name: "Inbox", exact: true })
    .click();
  await expect(title).toHaveText("Inbox");

  // A folder with notes can't be deleted; an empty one can.
  await menu(page, "Projects", "Delete folder");
  await expect(
    page.getByText("Move or delete the notes in this folder first."),
  ).toBeVisible();
  await expect(item(page, "Projects")).toBeVisible();
  await sidebar(page).getByRole("button", { name: "New folder" }).click();
  await folderName.fill("Scratch");
  await folderName.press("Enter");
  await menu(page, "Scratch", "Delete folder");
  await expect(item(page, "Scratch")).toHaveCount(0);

  // The library survives a reload (it is stored, not page state).
  await page.reload();
  await expect(
    itemLi(page, "Archive").getByRole("button", {
      name: "Roadmap 2026",
      exact: true,
    }),
  ).toBeVisible();
});

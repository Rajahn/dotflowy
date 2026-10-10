import { expect, test } from "bun:test";

import type { WorkbenchState } from "./model";

import { fromSaved, toSaved } from "./persist";

test("a saved layout restores its panes, tabs and widths without history", () => {
  const state: WorkbenchState = {
    panes: [
      {
        id: "main",
        width: 1.5,
        activeTabId: "t2",
        tabs: [
          {
            id: "t1",
            rootId: null,
            q: "",
            preview: false,
            back: [],
            forward: [],
          },
          {
            id: "t2",
            rootId: "plan",
            q: "#work",
            preview: true,
            back: [{ rootId: null, q: "" }],
            forward: [],
          },
        ],
      },
      { id: "p1", width: 0.5, activeTabId: null, tabs: [] },
    ],
  };
  const saved = toSaved(state, "p1", { open: false, width: 300 });
  // History stacks are not saved.
  expect(JSON.stringify(saved)).not.toContain("back");

  let n = 0;
  const restored = fromSaved(saved, () => `r${++n}`)!;
  expect(restored.activePaneId).toBe("p1");
  const [main, side] = restored.state.panes;
  // Fresh tab ids, the active tab follows its tab.
  expect(main!.tabs.map((t) => [t.id, t.rootId, t.q, t.preview])).toEqual([
    ["r1", null, "", false],
    ["r2", "plan", "#work", true],
  ]);
  expect(main!.activeTabId).toBe("r2");
  expect(main!.width).toBe(1.5);
  expect(main!.tabs[1]!.back).toEqual([]);
  expect(side).toEqual({ id: "p1", width: 0.5, activeTabId: null, tabs: [] });
});

test("a saved layout naming a missing pane or too many panes is repaired", () => {
  const pane = (id: string) => ({ id, width: 0, activeTabId: "x", tabs: [] });
  const restored = fromSaved(
    {
      panes: ["a", "b", "c", "d", "e"].map(pane),
      activePaneId: "gone",
      sidebar: { open: true, width: 240 },
    },
    () => "t",
  )!;
  expect(restored.state.panes.map((p) => p.id)).toEqual(["a", "b", "c", "d"]);
  expect(restored.activePaneId).toBe("a");
  // A non-positive width falls back to equal, a missing active tab to none.
  expect(restored.state.panes[0]).toMatchObject({
    width: 1,
    activeTabId: null,
  });
  expect(
    fromSaved(
      { panes: [], activePaneId: "a", sidebar: { open: true, width: 1 } },
      () => "t",
    ),
  ).toBeUndefined();
});

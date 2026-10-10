import { describe, expect, test } from "bun:test";

import {
  applyUrlResolution,
  closeTab,
  closeTabsWhere,
  makeTab,
  moveTab,
  openTab,
  pinTab,
  setPaneWidths,
  splitPane,
  resolveUrlChange,
  tabBack,
  tabForward,
  zoomTab,
  type TabView,
  type UrlChange,
  type UrlResolution,
  type WorkbenchState,
  type WorkbenchTab,
} from "./model";

const view = (rootId: string | null, q = ""): TabView => ({ rootId, q });

function tab(
  id: string,
  rootId: string | null,
  back: (string | null)[] = [],
  forward: (string | null)[] = [],
): WorkbenchTab {
  return {
    ...makeTab(id, view(rootId)),
    back: back.map((r) => view(r)),
    forward: forward.map((r) => view(r)),
  };
}

// Two panes: the left one (active in most rows) holds a tab zoomed from the
// top into A then B, and a second tab on C; the right one shows D.
const LAYOUT: WorkbenchState = {
  panes: [
    {
      id: "left",
      tabs: [tab("t1", "B", [null, "A"], ["E"]), tab("t2", "C")],
      activeTabId: "t1",
      width: 1,
    },
    { id: "right", tabs: [tab("t3", "D")], activeTabId: "t3", width: 1 },
  ],
};

describe("URL change resolution (PLAN 1.7)", () => {
  test.each<[string, string, string | null, UrlChange, UrlResolution]>([
    // Browser back to a view in the active tab's back stack: the tab steps back.
    [
      "back into history",
      "left",
      "A",
      "back",
      { kind: "back", paneId: "left", tabId: "t1" },
    ],
    [
      "back to the top",
      "left",
      null,
      "back",
      { kind: "back", paneId: "left", tabId: "t1" },
    ],
    // Forward into the active tab's forward stack.
    [
      "forward into history",
      "left",
      "E",
      "forward",
      { kind: "forward", paneId: "left", tabId: "t1" },
    ],
    // Not in the active tab's history, but open in another tab: focus it.
    [
      "back to another tab's root",
      "left",
      "C",
      "back",
      { kind: "focus", paneId: "left", tabId: "t2" },
    ],
    [
      "back to another pane's root",
      "left",
      "D",
      "back",
      { kind: "focus", paneId: "right", tabId: "t3" },
    ],
    // Open nowhere: the active tab zooms there.
    [
      "back to an unopened root",
      "left",
      "Z",
      "back",
      { kind: "zoom", paneId: "left", tabId: "t1" },
    ],
    // A pop of unknown direction looks back first, then forward.
    [
      "go into the forward stack",
      "left",
      "E",
      "pop",
      { kind: "forward", paneId: "left", tabId: "t1" },
    ],
    // Another surface navigating zooms the active tab, or replaces its view.
    [
      "in-app push",
      "right",
      "A",
      "push",
      { kind: "zoom", paneId: "right", tabId: "t3" },
    ],
    [
      "in-app replace",
      "left",
      "Z",
      "replace",
      { kind: "replace", paneId: "left", tabId: "t1" },
    ],
    // A deep link focuses an open tab (the active pane's first), else opens one.
    [
      "deep link to an open root",
      "right",
      "C",
      "enter",
      { kind: "focus", paneId: "left", tabId: "t2" },
    ],
    [
      "deep link prefers the active pane",
      "right",
      "D",
      "enter",
      { kind: "focus", paneId: "right", tabId: "t3" },
    ],
    [
      "deep link to a new root",
      "right",
      "Z",
      "enter",
      { kind: "open", paneId: "right" },
    ],
  ])("%s", (_name, activePaneId, rootId, change, expected) => {
    expect(
      resolveUrlChange(LAYOUT, activePaneId, view(rootId), change),
    ).toEqual(expected);
  });
});

test("a back step walks to the most recent matching entry and fills forward", () => {
  // t1 went top -> A -> B, with E ahead from an earlier back step.
  const stepped = tabBack(LAYOUT.panes[0]!.tabs[0]!, null)!;
  expect(stepped.rootId).toBeNull();
  expect(stepped.back).toEqual([]);
  expect(stepped.forward.map((v) => v.rootId)).toEqual(["A", "B", "E"]);

  const again = tabForward(stepped, "B")!;
  expect(again.rootId).toBe("B");
  expect(again.back.map((v) => v.rootId)).toEqual([null, "A"]);
  expect(again.forward.map((v) => v.rootId)).toEqual(["E"]);

  expect(tabBack(tab("x", "A"), "Q")).toBeUndefined();
});

test("a zoom records the view it left and drops the forward stack", () => {
  const zoomed = zoomTab(tab("x", "A", [null], ["B"]), view("C"));
  expect(zoomed.rootId).toBe("C");
  expect(zoomed.back).toEqual([view(null), view("A")]);
  expect(zoomed.forward).toEqual([]);
  // The same view is not a new history entry.
  const same = tab("y", "A");
  expect(zoomTab(same, view("A"))).toBe(same);
});

test("applying a resolution takes the URL's filter and activates the tab", () => {
  const ids = ["new"];
  const makeId = () => ids.shift()!;

  const focused = applyUrlResolution(
    LAYOUT,
    { kind: "focus", paneId: "left", tabId: "t2" },
    view("C", "#work"),
    makeId,
  );
  const left = focused.state.panes[0]!;
  expect(left.activeTabId).toBe("t2");
  expect(left.tabs[1]).toMatchObject({ rootId: "C", q: "#work" });

  const opened = applyUrlResolution(
    LAYOUT,
    { kind: "open", paneId: "right" },
    view("Z"),
    makeId,
  );
  const right = opened.state.panes[1]!;
  expect(opened.tabId).toBe("new");
  expect(right.activeTabId).toBe("new");
  expect(right.tabs.map((t) => [t.id, t.rootId, t.preview])).toEqual([
    ["t3", "D", false],
    ["new", "Z", false],
  ]);
});

// --- tabs and panes (PLAN 1.3) ----------------------------------------------

function ids(): () => string {
  let n = 0;
  return () => `n${++n}`;
}

const ONE_PANE: WorkbenchState = {
  panes: [
    {
      id: "a",
      tabs: [tab("t1", null)],
      activeTabId: "t1",
      width: 1,
    },
  ],
};

test("a preview open replaces the pane's preview tab; a pinned open adds one", () => {
  const makeId = ids();
  const first = openTab(ONE_PANE, "a", view("X"), { preview: true }, makeId)!;
  const second = openTab(
    first.state,
    "a",
    view("Y"),
    { preview: true },
    makeId,
  )!;
  const pane = second.state.panes[0]!;
  // The preview tab for X was replaced in place by Y, still a preview.
  expect(pane.tabs.map((t) => [t.rootId, t.preview])).toEqual([
    [null, false],
    ["Y", true],
  ]);
  expect(pane.activeTabId).toBe(second.tabId);

  // Opening a root already in the pane focuses it; a pinned open of the
  // preview's root pins it rather than adding a tab.
  const pinned = openTab(
    second.state,
    "a",
    view("Y"),
    { preview: false },
    makeId,
  )!;
  expect(pinned.state.panes[0]!.tabs.map((t) => t.preview)).toEqual([
    false,
    false,
  ]);
  expect(pinned.tabId).toBe(second.tabId);

  // A pinned open adds after the active tab, and the next preview is new.
  const z = openTab(pinned.state, "a", view("Z"), { preview: false }, makeId)!;
  const w = openTab(z.state, "a", view("W"), { preview: true }, makeId)!;
  expect(w.state.panes[0]!.tabs.map((t) => t.rootId)).toEqual([
    null,
    "Y",
    "Z",
    "W",
  ]);
  expect(pinTab(w.state, w.tabId).panes[0]!.tabs[3]!.preview).toBe(false);
});

test("splitting copies the active view rightward, up to four columns", () => {
  const tabIds = ids();
  const paneIds = (() => {
    let n = 0;
    return () => `p${++n}`;
  })();
  let state = ONE_PANE;
  for (let i = 0; i < 3; i++) {
    const split = splitPane(state, state.panes[0]!.id, tabIds, paneIds)!;
    state = split.state;
  }
  // Each split went in right after the first pane.
  expect(state.panes.map((p) => p.id)).toEqual(["a", "p3", "p2", "p1"]);
  expect(state.panes.every((p) => p.tabs[0]!.rootId === null)).toBe(true);
  expect(splitPane(state, "a", tabIds, paneIds)).toBeUndefined();
});

test("closing and moving tabs closes emptied columns but keeps the last", () => {
  const state: WorkbenchState = {
    panes: [
      {
        id: "a",
        tabs: [tab("t1", "A"), tab("t2", "B")],
        activeTabId: "t2",
        width: 1,
      },
      { id: "b", tabs: [tab("t3", "C")], activeTabId: "t3", width: 1 },
    ],
  };
  // Closing the active tab activates its neighbour.
  const closed = closeTab(state, "t2");
  expect(closed.panes[0]).toMatchObject({ activeTabId: "t1" });
  // Closing a column's last tab closes the column...
  expect(closeTab(state, "t3").panes.map((p) => p.id)).toEqual(["a"]);
  // ...but the last column stays, empty.
  const lone = closeTab(closeTab(closed, "t3"), "t1");
  expect(lone.panes).toEqual([
    { id: "a", tabs: [], activeTabId: null, width: 1 },
  ]);
  // Moving the only tab of a column away closes that column.
  const moved = moveTab(state, "t3", "a", "t1");
  expect(moved.panes.map((p) => p.id)).toEqual(["a"]);
  expect(moved.panes[0]!.tabs.map((t) => t.id)).toEqual(["t3", "t1", "t2"]);
  expect(moved.panes[0]!.activeTabId).toBe("t3");
  // Reordering inside a column.
  expect(
    moveTab(state, "t1", "a", null).panes[0]!.tabs.map((t) => t.id),
  ).toEqual(["t2", "t1"]);
  // Tabs showing deleted roots close.
  expect(closeTabsWhere(state, (id) => id === "B" || id === "C").panes).toEqual(
    [
      {
        id: "a",
        tabs: [state.panes[0]!.tabs[0]!],
        activeTabId: "t1",
        width: 1,
      },
    ],
  );
});

test("a deep link reuses the untouched default tab, never a used one", () => {
  expect(resolveUrlChange(ONE_PANE, "a", view("X"), "enter")).toEqual({
    kind: "replace",
    paneId: "a",
    tabId: "t1",
  });
  const used = {
    panes: [{ ...ONE_PANE.panes[0]!, tabs: [tab("t1", null, ["Q"])] }],
  };
  expect(resolveUrlChange(used, "a", view("X"), "enter")).toEqual({
    kind: "open",
    paneId: "a",
  });
  // An empty pane opens a tab for any URL.
  const empty = { panes: [{ id: "a", tabs: [], activeTabId: null, width: 1 }] };
  expect(resolveUrlChange(empty, "a", view("X"), "back")).toEqual({
    kind: "open",
    paneId: "a",
  });
});

test("moving a tab into a column already showing its view focuses that tab instead", () => {
  const state: WorkbenchState = {
    panes: [
      {
        id: "a",
        tabs: [tab("t1", "A"), tab("t2", "X")],
        activeTabId: "t1",
        width: 1,
      },
      {
        id: "b",
        tabs: [tab("t3", "X"), tab("t4", "Y")],
        activeTabId: "t4",
        width: 1,
      },
    ],
  };
  const moved = moveTab(state, "t2", "b", null);
  expect(moved.panes[0]!.tabs.map((t) => t.id)).toEqual(["t1"]);
  expect(moved.panes[1]!.tabs.map((t) => t.id)).toEqual(["t3", "t4"]);
  expect(moved.panes[1]!.activeTabId).toBe("t3");
});

test("setPaneWidths keeps the same state when nothing changes", () => {
  const state: WorkbenchState = {
    panes: [{ id: "a", tabs: [tab("t1", "A")], activeTabId: "t1", width: 2 }],
  };
  expect(setPaneWidths(state, new Map([["a", 2]]))).toBe(state);
  expect(setPaneWidths(state, new Map([["a", 3]])).panes[0]!.width).toBe(3);
});

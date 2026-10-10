import { describe, expect, test } from "bun:test";

import {
  applyUrlResolution,
  makeTab,
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
    },
    { id: "right", tabs: [tab("t3", "D")], activeTabId: "t3" },
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

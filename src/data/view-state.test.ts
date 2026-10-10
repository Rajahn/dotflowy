import { afterEach, describe, expect, test } from "bun:test";

import type { QueryFilter } from "./filter-query";

import { DEFAULT_PANE_ID, setActivePaneId } from "./panes";
import { createNode } from "./tree";
import {
  forgetPaneView,
  getViewFilter,
  getViewFilterFor,
  getViewIsHidden,
  getViewIsHiddenFor,
  getViewRootId,
  getViewRootIdFor,
  setPaneView,
} from "./view-state";

const hideAll = () => true;
const FILTER: QueryFilter = {
  visibleIds: new Set(["a"]),
  matchIds: new Set(["a"]),
};

afterEach(() => {
  forgetPaneView("left");
  forgetPaneView("right");
  setActivePaneId(DEFAULT_PANE_ID);
});

describe("per-pane view state", () => {
  test("each pane keeps its own zoom root, prune and filter", () => {
    setPaneView("left", { rootId: "a", isHidden: hideAll, filter: FILTER });
    setPaneView("right", { rootId: "b" });

    expect(getViewRootIdFor("left")).toBe("a");
    expect(getViewRootIdFor("right")).toBe("b");
    expect(getViewIsHiddenFor("left")).toBe(hideAll);
    expect(getViewIsHiddenFor("right")(createNode({ id: "x" }))).toBe(false);
    expect(getViewFilterFor("left")).toBe(FILTER);
    expect(getViewFilterFor("right")).toBeNull();
  });

  test("the plain getters answer for the active pane", () => {
    setPaneView("left", { rootId: "a", isHidden: hideAll, filter: FILTER });
    setPaneView("right", { rootId: "b" });

    setActivePaneId("left");
    expect(getViewRootId()).toBe("a");
    expect(getViewIsHidden()).toBe(hideAll);
    expect(getViewFilter()).toBe(FILTER);

    setActivePaneId("right");
    expect(getViewRootId()).toBe("b");
    expect(getViewFilter()).toBeNull();
  });

  test("an unknown or forgotten pane reads as the unzoomed, unfiltered view", () => {
    expect(getViewRootIdFor("nowhere")).toBeNull();
    setPaneView("left", { rootId: "a" });
    forgetPaneView("left");
    expect(getViewRootIdFor("left")).toBeNull();
    expect(getViewFilterFor("left")).toBeNull();
  });
});

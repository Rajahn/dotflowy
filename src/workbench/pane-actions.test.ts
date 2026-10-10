import { afterEach, describe, expect, test } from "bun:test";

import { DEFAULT_PANE_ID, setActivePaneId } from "../data/panes";
import { dispatchPaneAction, registerPaneActions } from "./pane-actions";

function recorder() {
  const calls: string[] = [];
  return {
    calls,
    actions: {
      undo: () => calls.push("undo"),
      redo: () => calls.push("redo"),
      zoomOut: () => calls.push("zoomOut"),
    },
  };
}

const disposers: (() => void)[] = [];
afterEach(() => {
  while (disposers.length) disposers.pop()!();
  setActivePaneId(DEFAULT_PANE_ID);
});

describe("workbench hotkey dispatch", () => {
  test("a chord runs once, on the active pane only", () => {
    const left = recorder();
    const right = recorder();
    disposers.push(registerPaneActions("left", left.actions));
    disposers.push(registerPaneActions("right", right.actions));

    setActivePaneId("right");
    dispatchPaneAction("undo");
    dispatchPaneAction("zoomOut");
    expect(right.calls).toEqual(["undo", "zoomOut"]);
    expect(left.calls).toEqual([]);

    setActivePaneId("left");
    dispatchPaneAction("redo");
    expect(left.calls).toEqual(["redo"]);
  });

  test("a stale unregister never removes the remounted editor's actions", () => {
    const before = recorder();
    const after = recorder();
    const disposeBefore = registerPaneActions("left", before.actions);
    disposers.push(registerPaneActions("left", after.actions));
    disposeBefore();

    setActivePaneId("left");
    dispatchPaneAction("undo");
    expect(after.calls).toEqual(["undo"]);
    expect(before.calls).toEqual([]);
  });

  test("a pane with no editor is a no-op", () => {
    setActivePaneId("empty");
    expect(() => dispatchPaneAction("undo")).not.toThrow();
  });
});

import { describe, expect, it } from "vitest";

import {
  NO_SELECTION,
  isSelectAll,
  move,
  reconcile,
  select,
  selectAll,
  selectHow,
  selectOnly,
} from "./listSelection";

const order = ["a", "b", "c", "d", "e"];

describe("list selection", () => {
  it("picks one row, toggles rows and extends ranges", () => {
    let s = select(order, NO_SELECTION, "b", "single");
    expect(s).toEqual(selectOnly("b"));
    s = select(order, s, "d", "toggle");
    expect(s.keys).toEqual(["b", "d"]);
    s = select(order, s, "b", "toggle");
    expect(s.keys).toEqual(["d"]);
    // The range runs from the last toggled row, even one toggled off.
    s = select(order, s, "a", "range");
    expect(s.keys).toEqual(["a", "b"]);
    expect(s.anchor).toBe("b");
    s = select(order, s, "e", "range");
    expect(s.keys).toEqual(["b", "c", "d", "e"]);
  });

  it("moves with the arrow keys, extending with Shift", () => {
    let s = selectOnly("b");
    s = move(order, s, 1, false);
    expect(s).toEqual(selectOnly("c"));
    s = move(order, s, 1, true);
    s = move(order, s, 1, true);
    expect(s.keys).toEqual(["c", "d", "e"]);
    s = move(order, s, 1, true);
    // Stops at the end.
    expect(s.keys).toEqual(["c", "d", "e"]);
    s = move(order, s, -3, true);
    expect(s.keys).toEqual(["b", "c"]);
  });

  it("selects every row", () => {
    const s = selectAll(order, selectOnly("c"));
    expect(s.keys).toEqual(order);
    expect(s.focus).toBe("c");
  });

  it("drops rows that are gone and falls back to the first", () => {
    const s = { keys: ["b", "x"], anchor: "x", focus: "x" };
    expect(reconcile(order, s)).toEqual({ keys: ["b"], anchor: "b", focus: "b" });
    expect(reconcile(order, { keys: ["x"], anchor: "x", focus: "x" })).toEqual(selectOnly("a"));
    expect(reconcile([], selectOnly("a"))).toEqual(NO_SELECTION);
    // The keyboard stays on a row just deselected with ⌘-click.
    const toggledOff = select(order, { keys: ["a", "b"], anchor: "a", focus: "a" }, "b", "toggle");
    expect(reconcile(order, toggledOff).focus).toBe("b");
  });

  it("reads clicks and shortcuts per platform", () => {
    const click = { shiftKey: false, metaKey: false, ctrlKey: false };
    expect(selectHow({ ...click, metaKey: true }, "macos")).toBe("toggle");
    expect(selectHow({ ...click, ctrlKey: true }, "macos")).toBe("single");
    expect(selectHow({ ...click, ctrlKey: true }, "windows")).toBe("toggle");
    expect(selectHow({ ...click, shiftKey: true }, "linux")).toBe("range");

    const key = { key: "a", metaKey: false, ctrlKey: false, altKey: false, shiftKey: false };
    expect(isSelectAll({ ...key, metaKey: true }, "macos")).toBe(true);
    expect(isSelectAll({ ...key, ctrlKey: true }, "macos")).toBe(false);
    expect(isSelectAll({ ...key, ctrlKey: true }, "windows")).toBe(true);
    expect(isSelectAll({ ...key, key: "A", metaKey: true }, "macos")).toBe(true);
  });
});

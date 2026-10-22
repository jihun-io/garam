import { describe, expect, it } from "vitest";

import type { CommitSummary } from "../../ipc";
import type { HistoryRow } from "./rows";
import { NO_SELECTION, only, pick } from "./selection";

const commit = (id: string): HistoryRow => ({
  kind: "commit",
  id,
  commit: { oid: id } as CommitSummary,
});

const rows: HistoryRow[] = [
  { kind: "wip", id: "wip", count: 1 },
  commit("a"),
  commit("b"),
  { kind: "stash", id: "s", commit: { oid: "s" } as CommitSummary, stash: {} as never },
  commit("c"),
  commit("d"),
];

describe("pick", () => {
  it("selects one row with a plain click", () => {
    expect(pick(rows, only("a"), "c", "single")).toEqual(only("c"));
  });

  it("adds and removes commits with Cmd-click", () => {
    let selection = pick(rows, only("a"), "c", "toggle");
    expect(selection).toEqual({ ids: ["a", "c"], anchor: "c", focus: "c" });
    selection = pick(rows, selection, "a", "toggle");
    expect(selection.ids).toEqual(["c"]);
    expect(pick(rows, selection, "c", "toggle")).toEqual({ ids: [], anchor: "c", focus: null });
  });

  it("selects a range of commits with Shift, skipping other rows", () => {
    const selection = pick(rows, only("a"), "d", "range");
    expect(selection).toEqual({ ids: ["a", "b", "c", "d"], anchor: "a", focus: "d" });
    // The anchor stays; the range follows the pointer.
    expect(pick(rows, selection, "b", "range").ids).toEqual(["a", "b"]);
    expect(pick(rows, only("c"), "a", "range").ids).toEqual(["a", "b", "c"]);
  });

  it("keeps changes and stashes to themselves", () => {
    expect(pick(rows, only("a"), "wip", "toggle")).toEqual(only("wip"));
    expect(pick(rows, only("a"), "s", "range")).toEqual(only("s"));
    // From a lone stash, a Cmd-click starts over with commits.
    expect(pick(rows, only("s"), "b", "toggle").ids).toEqual(["b"]);
    expect(pick(rows, NO_SELECTION, "b", "range").ids).toEqual(["b"]);
  });
});

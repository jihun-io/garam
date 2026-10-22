import { describe, expect, it } from "vitest";

import { buildGraph, type GraphLine } from "./graph";

const line = (from: number, to: number, dashed = false): GraphLine => ({ from, to, dashed });

describe("buildGraph", () => {
  it("draws a straight history in one lane", () => {
    const graph = buildGraph([
      { id: "c", parents: ["b"] },
      { id: "b", parents: ["a"] },
      { id: "a", parents: [] },
    ]);
    expect(graph.rows).toEqual([
      { column: 0, width: 1, upper: [], lower: [line(0, 0)] },
      { column: 0, width: 1, upper: [line(0, 0)], lower: [line(0, 0)] },
      { column: 0, width: 1, upper: [line(0, 0)], lower: [] },
    ]);
  });

  it("branches out at a merge and joins back at the fork point", () => {
    //   m        merge of b (first parent) and s
    //   | \
    //   b  s
    //   | /
    //   a
    const { rows } = buildGraph([
      { id: "m", parents: ["b", "s"] },
      { id: "b", parents: ["a"] },
      { id: "s", parents: ["a"] },
      { id: "a", parents: [] },
    ]);
    expect(rows[0]).toEqual({ column: 0, width: 2, upper: [], lower: [line(0, 0), line(0, 1)] });
    expect(rows[1]).toEqual({
      column: 0,
      width: 2,
      upper: [line(0, 0), line(1, 1)],
      lower: [line(1, 1), line(0, 0)],
    });
    // s waits in lane 1; a is already awaited in lane 0, so s joins it.
    expect(rows[2]).toEqual({
      column: 1,
      width: 2,
      upper: [line(0, 0), line(1, 1)],
      lower: [line(0, 0), line(1, 0)],
    });
    // Back to one lane: this row is narrow again.
    expect(rows[3]).toEqual({ column: 0, width: 1, upper: [line(0, 0)], lower: [] });
  });

  it("starts a new lane for another branch tip and reuses freed lanes", () => {
    const { rows } = buildGraph([
      { id: "x", parents: ["a"] },
      { id: "y", parents: ["a"] },
      { id: "a", parents: [] },
      { id: "z", parents: [] },
    ]);
    expect(rows.map((r) => r.column)).toEqual([0, 1, 0, 0]);
    // Like `git log --graph`, y joins the lane already waiting for a.
    expect(rows[1].lower).toEqual([line(0, 0), line(1, 0)]);
    expect(rows[2].upper).toEqual([line(0, 0)]);
  });

  it("follows only first parents when asked", () => {
    const { rows } = buildGraph(
      [
        { id: "m", parents: ["b", "s"] },
        { id: "b", parents: [] },
      ],
      true,
    );
    expect(rows.map((r) => r.width)).toEqual([1, 1]);
    expect(rows[0].lower).toEqual([line(0, 0)]);
  });

  it("dashes the lane of uncommitted changes down to HEAD", () => {
    const { rows } = buildGraph([
      { id: "wip", parents: ["head"], dashed: true },
      { id: "incoming", parents: ["base"] },
      { id: "head", parents: ["base"] },
      { id: "base", parents: [] },
    ]);
    expect(rows[0].lower).toEqual([line(0, 0, true)]);
    expect(rows[1]).toEqual({
      column: 1,
      width: 2,
      upper: [line(0, 0, true)],
      lower: [line(0, 0, true), line(1, 1)],
    });
    expect(rows[2].column).toBe(0);
    expect(rows[2].upper).toEqual([line(0, 0, true), line(1, 1)]);
  });

  it("keeps earlier rows narrow when wider rows load later", () => {
    const narrow = [
      { id: "c", parents: ["b"] },
      { id: "b", parents: ["a"] },
    ];
    const wide = [
      { id: "a", parents: ["x", "y", "z"] },
      { id: "x", parents: [] },
    ];
    const before = buildGraph(narrow).rows;
    const after = buildGraph([...narrow, ...wide]).rows;
    expect(after.slice(0, 2)).toEqual(before);
    expect(after[2].width).toBe(3);
  });

  it("keeps lines going past the loaded rows", () => {
    const { rows } = buildGraph([{ id: "b", parents: ["a"] }]);
    expect(rows[0].lower).toEqual([line(0, 0)]);
  });
});

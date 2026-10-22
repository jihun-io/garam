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
    expect(graph.width).toBe(1);
    expect(graph.rows).toEqual([
      { column: 0, upper: [], lower: [line(0, 0)] },
      { column: 0, upper: [line(0, 0)], lower: [line(0, 0)] },
      { column: 0, upper: [line(0, 0)], lower: [] },
    ]);
  });

  it("branches out at a merge and joins back at the fork point", () => {
    //   m        merge of b (first parent) and s
    //   | \
    //   b  s
    //   | /
    //   a
    const { rows, width } = buildGraph([
      { id: "m", parents: ["b", "s"] },
      { id: "b", parents: ["a"] },
      { id: "s", parents: ["a"] },
      { id: "a", parents: [] },
    ]);
    expect(width).toBe(2);
    expect(rows[0]).toEqual({ column: 0, upper: [], lower: [line(0, 0), line(0, 1)] });
    expect(rows[1]).toEqual({
      column: 0,
      upper: [line(0, 0), line(1, 1)],
      lower: [line(1, 1), line(0, 0)],
    });
    // s waits in lane 1; a is already awaited in lane 0, so s joins it.
    expect(rows[2]).toEqual({
      column: 1,
      upper: [line(0, 0), line(1, 1)],
      lower: [line(0, 0), line(1, 0)],
    });
    expect(rows[3]).toEqual({ column: 0, upper: [line(0, 0)], lower: [] });
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
    const { rows, width } = buildGraph(
      [
        { id: "m", parents: ["b", "s"] },
        { id: "b", parents: [] },
      ],
      true,
    );
    expect(width).toBe(1);
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
      upper: [line(0, 0, true)],
      lower: [line(0, 0, true), line(1, 1)],
    });
    expect(rows[2].column).toBe(0);
    expect(rows[2].upper).toEqual([line(0, 0, true), line(1, 1)]);
  });

  it("keeps lines going past the loaded rows", () => {
    const { rows } = buildGraph([{ id: "b", parents: ["a"] }]);
    expect(rows[0].lower).toEqual([line(0, 0)]);
  });
});

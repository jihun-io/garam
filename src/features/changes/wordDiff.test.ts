import { describe, expect, it } from "vitest";

import type { DiffLine, Hunk } from "../../ipc";
import { hunkWordChanges, wordChanges } from "./wordDiff";

const slice = (text: string, ranges: [number, number][]) =>
  ranges.map(([s, e]) => text.slice(s, e));

describe("wordChanges", () => {
  it("finds the words that changed", () => {
    const before = "const total = price * count;";
    const after = "const total = price * quantity;";
    const changes = wordChanges(before, after)!;
    expect(slice(before, changes.before)).toEqual(["count"]);
    expect(slice(after, changes.after)).toEqual(["quantity"]);
  });

  it("handles Korean text and insertions", () => {
    const before = "변경 사항을 저장합니다";
    const after = "변경 사항을 모두 저장합니다";
    const changes = wordChanges(before, after)!;
    expect(changes.before).toEqual([]);
    expect(slice(after, changes.after)).toEqual(["모두 "]);
  });

  it("gives up on lines that hardly match", () => {
    expect(wordChanges("return a;", 'throw new Error("nope");')).toBeNull();
    expect(wordChanges("x ".repeat(400), "y ".repeat(400))).toBeNull();
  });
});

const line = (kind: DiffLine["kind"], text: string): DiffLine => ({
  kind,
  text,
  oldLine: null,
  newLine: null,
  noNewline: false,
  staged: false,
});

describe("hunkWordChanges", () => {
  it("pairs each deleted line with the added line in the same place", () => {
    const lines = [
      line("context", "a"),
      line("deleted", "let one = 1;"),
      line("deleted", "let two = 2;"),
      line("added", "let one = 10;"),
      line("added", "let two = 20;"),
      line("added", "let three = 3;"),
      line("context", "b"),
    ];
    const hunk: Hunk = { oldStart: 1, oldLines: 4, newStart: 1, newLines: 5, section: "", lines };
    const changes = hunkWordChanges([hunk]);
    expect(slice(lines[1].text, changes.get(lines[1])!)).toEqual(["1"]);
    expect(slice(lines[3].text, changes.get(lines[3])!)).toEqual(["10"]);
    expect(slice(lines[4].text, changes.get(lines[4])!)).toEqual(["20"]);
    expect(changes.has(lines[5])).toBe(false);
    expect(changes.has(lines[0])).toBe(false);
  });
});

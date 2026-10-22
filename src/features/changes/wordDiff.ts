// Word-level changes inside a changed line: which parts of a deleted line
// and the added line that replaced it actually differ.

import type { DiffLine, Hunk } from "../../ipc";

/** A changed stretch of a line's text, as [start, end) in UTF-16 units. */
export type Range = [number, number];

/** Lines longer than this (in tokens) aren't compared word by word. */
const MAX_TOKENS = 300;
/** Pairs that differ in more than this share of their text are shown as whole lines. */
const MAX_CHANGED = 0.6;

/** Words, runs of spaces, and single other characters. */
function tokenize(text: string): string[] {
  return text.match(/[\p{L}\p{N}_]+|\s+|./gsu) ?? [];
}

/**
 * Character ranges that differ between `before` and `after`, or `null`
 * when they're too long or too different for word highlights to help.
 */
export function wordChanges(
  before: string,
  after: string,
): { before: Range[]; after: Range[] } | null {
  const a = tokenize(before);
  const b = tokenize(after);
  if (a.length > MAX_TOKENS || b.length > MAX_TOKENS) return null;

  // Longest common subsequence of tokens.
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const ranges = { before: [] as Range[], after: [] as Range[] };
  const mark = (list: Range[], start: number, end: number) => {
    const last = list[list.length - 1];
    if (last && last[1] === start) last[1] = end;
    else list.push([start, end]);
  };
  let [i, j, x, y] = [0, 0, 0, 0];
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      x += a[i++].length;
      y += b[j++].length;
    } else if (j < b.length && (i === a.length || lcs[i][j + 1] >= lcs[i + 1][j])) {
      mark(ranges.after, y, (y += b[j++].length));
    } else {
      mark(ranges.before, x, (x += a[i++].length));
    }
  }

  const changed = (list: Range[]) => list.reduce((sum, [s, e]) => sum + e - s, 0);
  const total = before.length + after.length;
  if (total === 0 || (changed(ranges.before) + changed(ranges.after)) / total > MAX_CHANGED) {
    return null;
  }
  return ranges;
}

/**
 * Word changes for every line that replaced another: in each run of
 * deleted lines followed by added lines, the n-th deleted line is paired
 * with the n-th added one.
 */
export function hunkWordChanges(hunks: Hunk[]): Map<DiffLine, Range[]> {
  const result = new Map<DiffLine, Range[]>();
  for (const hunk of hunks) {
    const lines = hunk.lines;
    let i = 0;
    while (i < lines.length) {
      if (lines[i].kind !== "deleted") {
        i++;
        continue;
      }
      const deleted: DiffLine[] = [];
      while (i < lines.length && lines[i].kind === "deleted") deleted.push(lines[i++]);
      const added: DiffLine[] = [];
      while (i < lines.length && lines[i].kind === "added") added.push(lines[i++]);
      for (let n = 0; n < Math.min(deleted.length, added.length); n++) {
        const changes = wordChanges(deleted[n].text, added[n].text);
        if (!changes) continue;
        if (changes.before.length > 0) result.set(deleted[n], changes.before);
        if (changes.after.length > 0) result.set(added[n], changes.after);
      }
    }
  }
  return result;
}

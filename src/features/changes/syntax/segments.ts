// Lays syntax colors and changed-word marks over one line of text.

import type { Range } from "../wordDiff";
import type { SyntaxToken } from "./highlight";

/** A run of the line that is either inside a changed-word mark or not. */
export type Segment = { start: number; marked: boolean; tokens: SyntaxToken[] };

/**
 * `text` cut into marked and unmarked runs (from `ranges`), each holding the
 * syntax tokens that fall inside it. Tokens that don't spell out `text`
 * (the grammar gave up on a long line, say) leave the rest plain.
 */
export function lineSegments(text: string, tokens?: SyntaxToken[], ranges?: Range[]): Segment[] {
  const pieces: SyntaxToken[] = [];
  let at = 0;
  for (const token of tokens ?? []) {
    if (!text.startsWith(token.text, at)) break;
    if (token.text) pieces.push(token);
    at += token.text.length;
  }
  if (at < text.length) pieces.push({ text: text.slice(at) });

  // Runs between consecutive mark edges.
  const edges = [0];
  for (const [start, end] of ranges ?? []) edges.push(start, end);
  edges.push(text.length);

  const segments: Segment[] = [];
  let piece = 0;
  let pieceStart = 0;
  for (let i = 0; i + 1 < edges.length; i++) {
    const [start, end] = [edges[i], edges[i + 1]];
    if (end <= start) continue;
    const runTokens: SyntaxToken[] = [];
    let pos = start;
    while (pos < end) {
      const token = pieces[piece];
      const pieceEnd = pieceStart + token.text.length;
      const cut = Math.min(end, pieceEnd);
      runTokens.push({ ...token, text: token.text.slice(pos - pieceStart, cut - pieceStart) });
      pos = cut;
      if (cut === pieceEnd) {
        piece += 1;
        pieceStart = pieceEnd;
      }
    }
    segments.push({ start, marked: i % 2 === 1, tokens: runTokens });
  }
  return segments;
}

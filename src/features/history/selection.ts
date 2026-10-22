import type { SelectHow } from "./CommitList";
import type { HistoryRow } from "./rows";

/** Selected rows in the history list. */
export type Selection = {
  ids: string[];
  /** Where a Shift range starts. */
  anchor: string | null;
  /** The row the keyboard is on. */
  focus: string | null;
};

export const NO_SELECTION: Selection = { ids: [], anchor: null, focus: null };

export const only = (id: string): Selection => ({ ids: [id], anchor: id, focus: id });

/**
 * The selection after picking `id`. Several rows can be selected only
 * among commits: picking changes or a stash selects just that row.
 */
export function pick(
  rows: HistoryRow[],
  current: Selection,
  id: string,
  how: SelectHow,
): Selection {
  const row = rows.find((r) => r.id === id);
  if (!row) return current;
  if (how === "single" || row.kind !== "commit") return only(id);
  const isCommit = (i: string) => rows.some((r) => r.id === i && r.kind === "commit");
  const ids = current.ids.filter(isCommit);

  if (how === "toggle") {
    const next = ids.includes(id) ? ids.filter((i) => i !== id) : [...ids, id];
    return { ids: next, anchor: id, focus: next.length > 0 ? id : null };
  }
  const anchor = current.anchor !== null && isCommit(current.anchor) ? current.anchor : id;
  const [from, to] = [rows.findIndex((r) => r.id === anchor), rows.indexOf(row)].sort(
    (a, b) => a - b,
  );
  return {
    ids: rows.slice(from, to + 1).flatMap((r) => (r.kind === "commit" ? [r.id] : [])),
    anchor,
    focus: id,
  };
}

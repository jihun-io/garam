import type { CommitSummary, Stash } from "../../ipc";
import type { GraphNode } from "./graph";

/** A row of the history list. */
export type HistoryRow =
  | { kind: "wip"; id: typeof WIP_ID; count: number }
  | { kind: "commit"; id: string; commit: CommitSummary }
  | { kind: "stash"; id: string; commit: CommitSummary; stash: Stash };

/** Not a commit id (those are hex), so it can't collide with one. */
export const WIP_ID = "wip";

/**
 * Rows in drawing order. With `extras`, uncommitted changes come first
 * (above HEAD), then commits waiting to be pulled, and each stash sits
 * right above the commit it was made on.
 */
export function buildRows({
  own,
  incoming,
  stashes,
  changedFiles,
  head,
  extras,
}: {
  own: CommitSummary[];
  incoming: CommitSummary[];
  stashes: Stash[];
  changedFiles: number;
  head: string | null;
  extras: boolean;
}): HistoryRow[] {
  const commitRow = (commit: CommitSummary): HistoryRow => ({
    kind: "commit",
    id: commit.oid,
    commit,
  });
  if (!extras) return unique(own.map(commitRow));

  const rows: HistoryRow[] = [];
  if (changedFiles > 0 && head !== null)
    rows.push({ kind: "wip", id: WIP_ID, count: changedFiles });
  // Markers can lag behind the history: right after a pull, commits that
  // were incoming are already on HEAD.
  const onHead = new Set(own.map((c) => c.oid));
  rows.push(...incoming.filter((c) => !onHead.has(c.oid)).map(commitRow));
  const byBase = new Map<string, Stash[]>();
  for (const stash of stashes) byBase.set(stash.base, [...(byBase.get(stash.base) ?? []), stash]);
  for (const commit of own) {
    for (const stash of byBase.get(commit.oid) ?? []) {
      rows.push({
        kind: "stash",
        id: stash.oid,
        stash,
        commit: {
          oid: stash.oid,
          parents: [stash.base],
          authorName: "",
          authorEmail: "",
          authoredAt: stash.createdAt,
          summary: stash.message ?? "",
        },
      });
    }
    rows.push(commitRow(commit));
  }
  return unique(rows);
}

/**
 * Rows keep their first place if an id comes twice (pages loaded while
 * the history moved can overlap); the list keys rows by id.
 */
function unique(rows: HistoryRow[]): HistoryRow[] {
  const seen = new Set<string>();
  return rows.filter((row) => !seen.has(row.id) && seen.add(row.id));
}

export function graphNodes(rows: HistoryRow[], head: string | null): GraphNode[] {
  return rows.map((row) =>
    row.kind === "wip"
      ? { id: row.id, parents: head ? [head] : [], dashed: true }
      : { id: row.id, parents: row.commit.parents, dashed: row.kind === "stash" },
  );
}

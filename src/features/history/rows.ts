import type { TFunction } from "i18next";

import type { CommitSummary, StashEntry } from "../../ipc";
import type { GraphNode } from "./graph";

/** A row of the history list. */
export type HistoryRow =
  | { kind: "wip"; id: typeof WIP_ID; count: number }
  | { kind: "commit"; id: string; commit: CommitSummary }
  | { kind: "stash"; id: string; commit: CommitSummary; stash: StashEntry };

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
  stashes: StashEntry[];
  changedFiles: number;
  head: string | null;
  extras: boolean;
}): HistoryRow[] {
  const commitRow = (commit: CommitSummary): HistoryRow => ({
    kind: "commit",
    id: commit.oid,
    commit,
  });
  if (!extras) return own.map(commitRow);

  const rows: HistoryRow[] = [];
  if (changedFiles > 0 && head !== null)
    rows.push({ kind: "wip", id: WIP_ID, count: changedFiles });
  rows.push(...incoming.map(commitRow));
  const byBase = new Map<string, StashEntry[]>();
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
          authorName: stash.authorName,
          authorEmail: "",
          authoredAt: stash.createdAt,
          summary: stash.message,
        },
      });
    }
    rows.push(commitRow(commit));
  }
  return rows;
}

export function graphNodes(rows: HistoryRow[], head: string | null): GraphNode[] {
  return rows.map((row) =>
    row.kind === "wip"
      ? { id: row.id, parents: head ? [head] : [], dashed: true }
      : { id: row.id, parents: row.commit.parents, dashed: row.kind === "stash" },
  );
}

const STASH_MESSAGE = /^(WIP on|On) ([^:]+): (.*)$/s;
const AUTO_STASH = "garam-auto-stash:";

/** git's stash description, split into what it says. */
export function describeStash(
  message: string,
):
  | { kind: "auto"; branch: string }
  | { kind: "named"; text: string }
  | { kind: "untitled"; branch: string } {
  const match = STASH_MESSAGE.exec(message);
  if (!match) return { kind: "named", text: message };
  const [, prefix, branch, rest] = match;
  if (rest.startsWith(AUTO_STASH)) return { kind: "auto", branch: rest.slice(AUTO_STASH.length) };
  return prefix === "On" ? { kind: "named", text: rest } : { kind: "untitled", branch };
}

/** A stash's title in the user's language. */
export function stashTitle(t: TFunction<"history">, message: string): string {
  const stash = describeStash(message);
  switch (stash.kind) {
    case "auto":
      return t("stash.auto", { branch: stash.branch });
    case "untitled":
      return t("stash.untitled", { branch: stash.branch });
    case "named":
      return stash.text;
  }
}

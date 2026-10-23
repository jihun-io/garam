import type { HistoryMarkers, RefKind, RefLabel, TagSync } from "../../ipc";

/** One badge next to a commit. */
export type RefBadge = {
  kind: RefKind;
  name: string;
  current: boolean;
  /** Remote branches at the same commit with the same branch name, folded in. */
  remotes: string[];
};

const ORDER: Record<RefKind, number> = { head: 0, branch: 1, remote: 2, tag: 3 };

/**
 * Badges per commit id. A local branch absorbs remote branches of the same
 * name that point at the same commit (`main` + `origin/main` → one badge),
 * since that is the common, in-sync case.
 */
export function groupRefs(refs: RefLabel[]): Map<string, RefBadge[]> {
  const byOid = new Map<string, RefLabel[]>();
  for (const ref of refs) byOid.set(ref.oid, [...(byOid.get(ref.oid) ?? []), ref]);

  const result = new Map<string, RefBadge[]>();
  for (const [oid, labels] of byOid) {
    const branches = new Set(labels.filter((r) => r.kind === "branch").map((r) => r.name));
    const badges: RefBadge[] = labels
      .filter((r) => !(r.kind === "remote" && branches.has(remoteBranch(r.name))))
      .map((r) => ({
        kind: r.kind,
        name: r.name,
        current: r.current,
        remotes:
          r.kind === "branch"
            ? labels
                .filter((o) => o.kind === "remote" && remoteBranch(o.name) === r.name)
                .map((o) => o.name)
            : [],
      }));
    badges.sort((a, b) => Number(b.current) - Number(a.current) || ORDER[a.kind] - ORDER[b.kind]);
    result.set(oid, badges);
  }
  return result;
}

/** `origin/feature/x` → `feature/x`. */
function remoteBranch(name: string): string {
  const slash = name.indexOf("/");
  return slash < 0 ? name : name.slice(slash + 1);
}

/** How a commit relates to the upstream: not pushed, or not pulled yet. */
export type SyncState = "unpushed" | "incoming";

/** Everything drawn next to commits besides the commit itself. */
export type HistoryMarks = {
  refs: Map<string, RefBadge[]>;
  sync: Map<string, SyncState>;
  /** How each tag compares with the remote's, once known. */
  tags?: Map<string, TagSync> | null;
};

export const NO_MARKS: HistoryMarks = { refs: new Map(), sync: new Map() };

export function toMarks(markers: HistoryMarkers | undefined): HistoryMarks {
  if (!markers) return NO_MARKS;
  const sync = new Map<string, SyncState>();
  for (const oid of markers.unpushed) sync.set(oid, "unpushed");
  for (const commit of markers.incoming) sync.set(commit.oid, "incoming");
  return { refs: groupRefs(markers.refs), sync };
}

import type { BranchStatus } from "../../ipc";

export type PrimaryAction =
  | { action: "fetch" }
  | { action: "pull" }
  | { action: "push" }
  /** `disabled` when there's no commit to publish yet. */
  | { action: "publish"; disabled: boolean };

/** What the sync button does for the current branch. */
export function primaryAction(branch: BranchStatus, upstreamGone: boolean): PrimaryAction {
  if (branch.head === null) return { action: "fetch" };
  if (branch.upstream === null || upstreamGone) {
    return { action: "publish", disabled: branch.oid === null };
  }
  if (branch.behind > 0) return { action: "pull" };
  if (branch.ahead > 0) return { action: "push" };
  return { action: "fetch" };
}

/** Whether the branch has a live upstream to pull from and push to. */
export function hasUpstream(branch: BranchStatus, upstreamGone: boolean): boolean {
  return branch.head !== null && branch.upstream !== null && !upstreamGone;
}

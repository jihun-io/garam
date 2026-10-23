import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect } from "react";

import type { Branch, BranchStatus } from "../../ipc";
import { useCommand } from "../../lib/commands";
import { useNotify } from "../notify/notifyStore";
import { useRemoteInfo } from "../sync/api";
import {
  branchPullRequest,
  supportsPullRequests,
  usePullRequestContext,
  usePullRequests,
} from "./api";
import { CreatePullRequestDialog } from "./CreatePullRequestDialog";
import { usePullRequestDialog } from "./pullRequestDialogStore";

/**
 * Whether a pull request can be made from `branch` here: the current
 * branch always (it can be published or pushed first), another one only
 * once it's on the default remote with nothing left to push.
 */
export function canOpenFor(branch: Branch, defaultRemote: string | null): boolean {
  if (branch.kind !== "local") return false;
  if (branch.isHead) return true;
  return (
    defaultRemote !== null &&
    branch.upstream !== null &&
    branch.upstream.startsWith(`${defaultRemote}/`) &&
    !branch.upstreamGone &&
    branch.ahead === 0
  );
}

/**
 * The branch menu's pull request commands and the dialog they open.
 * Without an account "Create" still shows, and asks for one.
 */
export function PullRequestControls({ repo, status }: { repo: string; status: BranchStatus }) {
  const supported = supportsPullRequests(usePullRequestContext(repo).data);
  const list = usePullRequests(repo, status.head);
  const current = branchPullRequest(list.data, status.head, status.oid);
  const { branch, open, close } = usePullRequestDialog();
  const showError = useNotify((s) => s.showError);
  // A dialog left open for another repository's branch closes with it.
  useEffect(() => close, [repo, close]);

  const head = status.head;
  useCommand(
    "branch.createPullRequest",
    () => head && open(head),
    supported && head !== null && status.oid !== null && current?.state !== "open",
  );
  useCommand(
    "branch.viewPullRequest",
    () => current && void openUrl(current.url).catch(showError),
    current !== null,
  );

  return branch !== null ? (
    <CreatePullRequestDialog repo={repo} branch={branch} onClose={close} />
  ) : null;
}

/** The default remote's name, for `canOpenFor`. */
export function useDefaultRemote(repo: string): string | null {
  return useRemoteInfo(repo).data?.defaultRemote ?? null;
}

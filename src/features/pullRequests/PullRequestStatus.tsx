import { openUrl } from "@tauri-apps/plugin-opener";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";

import { Icon } from "../../components/Icon";
import type { IconName } from "../../components/icons";
import { ToolbarButton } from "../../components/ui/ToolbarButton";
import { Tooltip } from "../../components/ui/Tooltip";
import type { BranchStatus, PullRequest } from "../../ipc";
import { useNotify } from "../notify/notifyStore";
import { branchPullRequest, usePullRequestOffer, usePullRequests } from "./api";
import { usePullRequestDialog } from "./pullRequestDialogStore";
import styles from "./PullRequests.module.css";

type T = TFunction<"pullRequests">;

/** "Open", "Draft", "Merged" or "Closed". */
export function stateLabel(t: T, pr: PullRequest): string {
  if (pr.state === "open") return pr.draft ? t("state.draft") : t("state.open");
  return t(`state.${pr.state}`);
}

/** The checks and review as one sentence, for tooltips and screen readers. */
export function describe(t: T, pr: PullRequest): string {
  const parts = [t("describe.number", { number: pr.number, state: stateLabel(t, pr) })];
  const checks = pr.checks;
  if (checks?.state === "failure") {
    parts.push(t("describe.checksFailed", { count: checks.total, failed: checks.failed }));
  } else if (checks?.state === "pending") {
    parts.push(t("describe.checksPending", { count: checks.total, pending: checks.pending }));
  } else if (checks?.state === "success") {
    parts.push(t("describe.checksPassed", { count: checks.total }));
  }
  if (pr.review === "approved") parts.push(t("describe.approved"));
  if (pr.review === "changes_requested") parts.push(t("describe.changesRequested"));
  return parts.join(" · ");
}

const CHECK_ICONS: Record<string, IconName> = {
  success: "checksPassed",
  failure: "checksFailed",
  pending: "checksPending",
};

/**
 * The checks' and review's icons. Shapes tell them apart; only a failure
 * takes a color (danger), the rest stay muted ink. Checks still running
 * turn slowly, as long as they run.
 */
export function PullRequestMarks({ pr, size = 14 }: { pr: PullRequest; size?: 12 | 14 | 16 }) {
  const check = pr.checks?.state ? CHECK_ICONS[pr.checks.state] : null;
  const review: IconName | null =
    pr.review === "approved"
      ? "reviewApproved"
      : pr.review === "changes_requested"
        ? "changesRequested"
        : null;
  return (
    <span className={styles.marks} aria-hidden="true">
      {check && (
        <Icon
          name={check}
          size={size}
          className={
            pr.checks?.state === "failure"
              ? styles.failed
              : pr.checks?.state === "pending"
                ? styles.running
                : undefined
          }
        />
      )}
      {review && <Icon name={review} size={size} />}
    </span>
  );
}

/**
 * Toolbar button for the current branch's pull request; opens it in the
 * browser. Without one, offers to create it when that makes sense (see
 * `usePullRequestOffer`); otherwise nothing shows.
 */
export function PullRequestBadge({ repo, status }: { repo: string; status: BranchStatus }) {
  const { t } = useTranslation("pullRequests");
  const showError = useNotify((s) => s.showError);
  const openDialog = usePullRequestDialog((s) => s.open);
  const list = usePullRequests(repo, status.head);
  const pr = branchPullRequest(list.data, status.head, status.oid);
  const offer = usePullRequestOffer(repo, status);
  if (!pr) {
    if (!offer || status.head === null) return null;
    const head = status.head;
    return (
      <Tooltip content={t("offer.tooltip", { branch: head })}>
        <ToolbarButton
          className={styles.badge}
          icon="pullRequest"
          caption={t("offer.caption")}
          value={t("create")}
          onClick={() => openDialog(head)}
        />
      </Tooltip>
    );
  }
  const sentence = describe(t, pr);
  return (
    <Tooltip content={sentence}>
      <ToolbarButton
        className={styles.badge}
        data-muted={pr.draft || pr.state !== "open" || undefined}
        icon="pullRequest"
        caption={stateLabel(t, pr)}
        value={`#${pr.number}`}
        trailing={<PullRequestMarks pr={pr} size={16} />}
        aria-label={sentence}
        onClick={() => void openUrl(pr.url).catch(showError)}
      />
    </Tooltip>
  );
}

/** Small "#12" and check icon in the branch list. */
export function PullRequestTag({ pr }: { pr: PullRequest }) {
  const { t } = useTranslation("pullRequests");
  return (
    <span className={styles.tag} data-muted={pr.draft || pr.state !== "open" || undefined}>
      <span className="sr-only">{describe(t, pr)}</span>
      <span aria-hidden="true">#{pr.number}</span>
      <PullRequestMarks pr={pr} size={12} />
    </span>
  );
}

/** Pull requests by local branch, as the branch list shows them. */
export function useBranchPullRequests(repo: string, status: BranchStatus) {
  const list = usePullRequests(repo, status.head).data;
  const byBranch = new Map<string, PullRequest>();
  for (const { branch, pullRequest } of list ?? []) {
    const shown =
      branch === status.head
        ? branchPullRequest(list, branch, status.oid)
        : pullRequest.state === "open"
          ? pullRequest
          : null;
    if (shown) byBranch.set(branch, shown);
  }
  return byBranch;
}

import { DropdownMenu } from "radix-ui";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import menu from "../../components/ui/Menu.module.css";
import { toAppError } from "../../ipc";
import { runCommand, shortcutFor, useCommand } from "../../lib/commands";
import { useRelativeTime } from "../../lib/time";
import { useBranches, useMergePreview } from "../branches/api";
import { CommitCounts } from "../branches/CommitCounts";
import { ConflictPreview } from "../branches/ConflictPreview";
import { useStatus } from "../changes/api";
import { useNotify } from "../notify/notifyStore";
import {
  branchPullRequest,
  supportsPullRequests,
  usePullRequestContext,
  usePullRequests,
} from "../pullRequests/api";
import { usePullRequestDialog } from "../pullRequests/pullRequestDialogStore";
import { useSettings } from "../settings/api";
import { useRemoteInfo, useSyncActions, type SyncResult } from "./api";
import { hasUpstream, primaryAction } from "./primaryAction";
import styles from "./SyncButton.module.css";
import { useSyncStore, type SyncAction } from "./syncStore";
import { useBackgroundFetch } from "./useBackgroundFetch";
import { Icon } from "../../components/Icon";
import { Button } from "../../components/ui/Button";
import { FormDialog } from "../../components/ui/Dialog";
import { ToolbarButton, ToolbarPlaceholder } from "../../components/ui/ToolbarButton";
import { Tooltip } from "../../components/ui/Tooltip";

/** Re-renders every `ms` so relative times stay current. */
function useTick(ms: number) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((n) => n + 1), ms);
    return () => clearInterval(timer);
  }, [ms]);
}

/**
 * The toolbar's one sync button: fetch, pull, push or publish depending on
 * the branch, plus a menu for the others. Hidden without remotes.
 */
export function SyncButton({ repo }: { repo: string }) {
  const { t } = useTranslation(["sync", "common"]);
  const relativeTime = useRelativeTime();
  const status = useStatus(repo);
  const info = useRemoteInfo(repo);
  const branches = useBranches(repo);
  const running = useSyncStore((s) => s.running[repo]);
  const { run, cancel } = useSyncActions(repo);
  const { showError, showErrorWithAction, showInfo } = useNotify();
  const remote = info.data?.defaultRemote ?? null;
  const { fetchIntervalMinutes, confirmConflictingPull } = useSettings();
  useBackgroundFetch(repo, remote, fetchIntervalMinutes);
  useTick(60 * 1000);

  const branch = status.data?.branch;
  const tags = status.data?.unpushedTags.length ?? 0;
  const ready = !!branch && !!info.data && info.data.remotes.length > 0;
  const upstreamGone =
    branches.data?.some((b) => b.kind === "local" && b.isHead && b.upstreamGone) ?? false;
  const primary = branch ? primaryAction(branch, upstreamGone, tags) : null;
  const tracked = branch ? hasUpstream(branch, upstreamGone) : false;
  const upstream = branch?.upstream ?? "";
  const head = branch?.head ?? "";
  const busy = running !== undefined;

  // After publishing or pushing, offer a pull request if there isn't one.
  const { t: tPr } = useTranslation("pullRequests");
  const prContext = usePullRequestContext(repo).data;
  const prList = usePullRequests(repo, status.data?.branch.head ?? null).data;
  const openPullRequest = usePullRequestDialog((s) => s.open);
  const offerPullRequest = () => {
    const current = branchPullRequest(prList, head || null, branch?.oid ?? null);
    if (!head || !supportsPullRequests(prContext) || current?.state === "open") {
      return undefined;
    }
    return { label: tPr("create"), run: () => openPullRequest(head) };
  };

  // A pull that local changes stopped can be retried with them stashed;
  // holds the files it would overwrite.
  const [blockedPull, setBlockedPull] = useState<string[] | null>(null);
  // What pulling would bring, as of the last fetch: commits, and the files
  // merging them would conflict on.
  const pullPreview = useMergePreview(
    repo,
    tracked && (branch?.behind ?? 0) > 0 ? "@{upstream}" : null,
  ).data;
  const pullConflicts = pullPreview?.conflicts ?? [];
  const [confirmPull, setConfirmPull] = useState(false);

  const resolveConflicts = {
    label: t("common:fix.resolveConflicts"),
    run: () => runCommand("view.changes"),
  };

  /** Pulls, first asking when the pull is expected to conflict. */
  const pull = () => {
    if (confirmConflictingPull && pullConflicts.length > 0) setConfirmPull(true);
    else start("pull");
  };

  const start = (action: SyncAction, autostash = false) => {
    // Push and publish carry the tags waiting now.
    const sentTags = action === "push" || action === "publish" ? tags : 0;
    run({ action, remote, autostash })
      .then((result) => result && announce(action, result, sentTags))
      .catch((e: unknown) => {
        const error = toAppError(e);
        const kind = error.kind;
        // Stashing didn't clear the way, so offering it again would loop;
        // the error's details say what git stopped on.
        if (kind === "pull_blocked_by_local_changes" && !autostash)
          setBlockedPull(error.params.files ? error.params.files.split("\0") : []);
        else if (kind === "cancelled") return;
        // The next step is plain from what failed: pull what the remote
        // has before pushing again (not pushing by itself, since the pull
        // may conflict), publish a branch the remote doesn't have, or
        // resolve what stopped.
        else if (kind === "non_fast_forward" && action === "push")
          showErrorWithAction(e, { label: t("common:fix.pullFirst"), run: pull });
        else if (kind === "no_upstream" || kind === "remote_branch_not_found")
          showErrorWithAction(e, { label: t("common:fix.publish"), run: () => start("publish") });
        else if (kind === "merge_conflict" || kind === "rebase_conflict")
          showErrorWithAction(e, resolveConflicts);
        else showError(e);
      });
  };

  const announce = (action: SyncAction, result: SyncResult, sentTags: number) => {
    const withTags = sentTags > 0 ? ` ${t("done.tagsToo", { count: sentTags })}` : "";
    if (action === "pull") {
      showInfo(
        result === "up_to_date"
          ? t("done.upToDate", { branch: head })
          : result === "updated_with_conflicts"
            ? t("done.pulledWithConflicts", { upstream })
            : t("done.pulled", { upstream }),
        result === "updated_with_conflicts" ? resolveConflicts : undefined,
      );
    } else if (action === "push") {
      showInfo(t("done.pushed", { upstream }) + withTags, offerPullRequest());
    } else if (action === "publish") {
      showInfo(
        t("done.published", { branch: head, remote: remote ?? "" }) + withTags,
        offerPullRequest(),
      );
    }
  };

  // Push publishes a branch that isn't on the remote yet.
  const canPublish = primary?.action === "publish" && !primary.disabled;
  useCommand("sync.fetch", () => start("fetch"), ready && !busy && !!remote);
  useCommand("sync.pull", pull, ready && !busy && tracked);
  useCommand(
    "sync.push",
    () => start(tracked ? "push" : "publish"),
    ready && !busy && (tracked ? (branch?.ahead ?? 0) > 0 || tags > 0 : canPublish),
  );

  // Hold the place while loading; without remotes there is nothing to sync.
  if (status.isError || info.isError) return null;
  if (!branch || !info.data) {
    return (
      <div className={styles.root}>
        <ToolbarPlaceholder icon="fetch" className={styles.main} />
      </div>
    );
  }
  if (!ready || !primary) return null;
  const primaryShortcut = shortcutFor(
    primary.action === "fetch"
      ? "sync.fetch"
      : primary.action === "pull"
        ? "sync.pull"
        : "sync.push",
  );
  const shown = running?.action ?? primary.action;
  const percent = running?.progress?.overallPercent ?? 0;
  const label = running
    ? t(`running.${running.action}`)
    : primary.action === "publish"
      ? t("action.publish")
      : t(`action.${primary.action}`, { remote: remote ?? "" });
  // The pull button tells what it would bring before it is pressed.
  const pullSummary =
    primary.action === "pull" && pullPreview && pullPreview.commits > 0
      ? pullConflicts.length > 0
        ? t("preview.withConflicts", {
            count: pullPreview.commits,
            files: t("preview.files", { count: pullConflicts.length }),
          })
        : t("preview.commits", { count: pullPreview.commits })
      : null;
  // The caption is a short state like the other actions'; the sentence
  // explaining it goes in the tooltip, where it isn't cut off.
  // (A disabled button shows no tooltip, so the unborn state has no hint.)
  const publishHint =
    primary.action === "publish" && !running && !primary.disabled
      ? t("publishHint", { remote: remote ?? "" })
      : null;
  const detail =
    primary.action === "publish" && !running
      ? primary.disabled
        ? t("unbornState")
        : t("publishState", { remote: remote ?? "" })
      : info.data.lastFetchedAt
        ? t("lastFetched", { time: relativeTime(info.data.lastFetchedAt) })
        : t("neverFetched");
  const tooltipDetail = running ? null : (pullSummary ?? publishHint);

  return (
    <div className={styles.root}>
      <Tooltip
        content={
          tooltipDetail ? (
            <>
              {label}
              <br />
              {tooltipDetail}
            </>
          ) : (
            label
          )
        }
        shortcut={primaryShortcut}
      >
        <ToolbarButton
          icon={shown}
          value={label}
          caption={detail}
          captionBelow
          className={styles.main}
          progress={busy ? percent : undefined}
          disabled={busy || (primary.action === "publish" && primary.disabled)}
          aria-busy={busy}
          onClick={() => (primary.action === "pull" ? pull() : start(primary.action))}
          trailing={
            <>
              {busy && (
                <span
                  className="sr-only"
                  role="progressbar"
                  aria-label={label}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={percent}
                />
              )}
              {tracked && <CommitCounts ahead={branch.ahead} behind={branch.behind} tags={tags} />}
            </>
          }
        />
      </Tooltip>
      {busy ? (
        <Tooltip content={t("cancel")}>
          <button type="button" className={styles.side} onClick={cancel} aria-label={t("cancel")}>
            <Icon name="close" size={14} />
          </button>
        </Tooltip>
      ) : (
        <DropdownMenu.Root>
          <Tooltip content={t("more")}>
            <DropdownMenu.Trigger asChild>
              <button type="button" className={styles.side} aria-label={t("more")}>
                <Icon name="dropdown" size={12} />
              </button>
            </DropdownMenu.Trigger>
          </Tooltip>
          <DropdownMenu.Portal>
            <DropdownMenu.Content className={menu.content} align="end" sideOffset={4}>
              <DropdownMenu.Item
                className={menu.item}
                disabled={!remote}
                onSelect={() => start("fetch")}
              >
                <Icon name="fetch" size={16} />
                {t("menu.fetch")}
              </DropdownMenu.Item>
              <DropdownMenu.Item className={menu.item} disabled={!tracked} onSelect={pull}>
                <Icon name="pull" size={16} />
                {t("menu.pull")}
              </DropdownMenu.Item>
              <DropdownMenu.Item
                className={menu.item}
                disabled={!tracked || (branch.ahead === 0 && tags === 0)}
                onSelect={() => start("push")}
              >
                <Icon name="push" size={16} />
                {t("menu.push")}
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      )}
      {confirmPull && (
        <ConflictingPullDialog
          upstream={upstream}
          commits={pullPreview?.commits ?? 0}
          conflicts={pullConflicts}
          onPull={() => {
            setConfirmPull(false);
            start("pull");
          }}
          onClose={() => setConfirmPull(false)}
        />
      )}
      {blockedPull && (
        <PullBlockedDialog
          files={blockedPull}
          onStash={() => {
            setBlockedPull(null);
            start("pull", true);
          }}
          onClose={() => setBlockedPull(null)}
        />
      )}
    </div>
  );
}

/** Asks before a pull that merging is expected to leave conflicted. */
function ConflictingPullDialog({
  upstream,
  commits,
  conflicts,
  onPull,
  onClose,
}: {
  upstream: string;
  commits: number;
  conflicts: string[];
  onPull: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation("sync");
  return (
    <FormDialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={t("conflictingPull.title")}
      description={t("conflictingPull.body", { count: commits, upstream })}
      onSubmit={onPull}
      footer={
        <>
          <Button onClick={onClose} autoFocus>
            {t("conflictingPull.cancel")}
          </Button>
          <Button type="submit" variant="primary">
            {t("conflictingPull.submit")}
          </Button>
        </>
      }
    >
      {/* The remote may have moved since the last fetch: "may". */}
      <ConflictPreview conflicts={conflicts} estimate />
      <p>{t("conflictingPull.after")}</p>
    </FormDialog>
  );
}

/** Offers to stash local changes for a pull they stopped. */
function PullBlockedDialog({
  files,
  onStash,
  onClose,
}: {
  files: string[];
  onStash: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation(["sync", "errors"]);
  return (
    <FormDialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={t("pullBlocked.title")}
      onSubmit={onStash}
      footer={
        <>
          <Button onClick={onClose}>{t("pullBlocked.cancel")}</Button>
          <Button type="submit" variant="primary" autoFocus>
            {t("pullBlocked.submit")}
          </Button>
        </>
      }
    >
      <p>{t("errors:pull_blocked_by_local_changes")}</p>
      {/* Empty when git refuses over any staged change, touched or not. */}
      {files.length > 0 && (
        <div className={styles.blockedFiles}>
          <p>{t("pullBlocked.files", { count: files.length })}</p>
          <ul>
            {files.map((path) => (
              <li key={path}>{path}</li>
            ))}
          </ul>
        </div>
      )}
      <p>{t("pullBlocked.body")}</p>
    </FormDialog>
  );
}

import { RadioGroup } from "radix-ui";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { ErrorMessage } from "../../components/ErrorMessage";
import { Icon } from "../../components/Icon";
import { Button } from "../../components/ui/Button";
import { FormDialog } from "../../components/ui/Dialog";
import segmented from "../../components/ui/Segmented.module.css";
import { toAppError, type AppError, type BaseStatus, type UpdateMode } from "../../ipc";
import { runCommand } from "../../lib/commands";
import { useStatus } from "../changes/api";
import { useNotify } from "../notify/notifyStore";
import { useSettings } from "../settings/api";
import { useRemoteInfo, useSyncActions } from "../sync/api";
import { useBaseStatus, useBranchActions } from "./api";
import { shouldNotify, useBaseNotices } from "./baseNotice";
import styles from "./branches.module.css";
import { ConflictPreview } from "./ConflictPreview";

/**
 * Says when the remote's default branch has moved on from the current one
 * far enough, or in a way that would conflict, and offers to bring it in.
 * Conflicts grow the longer a branch stays apart.
 */
export function BaseBanner({ repo, branch }: { repo: string; branch: string | null }) {
  const { t } = useTranslation("branches");
  const { baseNotices } = useSettings();
  const status = useBaseStatus(repo, baseNotices && branch !== null).data;
  const dismissed = useBaseNotices((s) => s.dismissed[repo]);
  const dismiss = useBaseNotices((s) => s.dismiss);
  const [updating, setUpdating] = useState(false);

  // The dialog outlives the banner: fetching as it opens may change what
  // the banner would say.
  const dialog = updating && branch && (
    <UpdateFromBaseDialog repo={repo} branch={branch} onClose={() => setUpdating(false)} />
  );
  if (!baseNotices || !branch || !status || !shouldNotify(status, dismissed)) {
    return dialog || null;
  }
  const conflicts = status.conflicts ?? [];
  return (
    <div className={styles.banner} role="status">
      <p className={styles.bannerTitle}>
        <Icon name="branch" />
        {t("base.behind", { count: status.behind, base: status.baseBranch })}
      </p>
      <p>
        {conflicts.length > 0 ? t("base.conflicts", { count: conflicts.length }) : t("base.far")}
      </p>
      <div className={styles.bannerActions}>
        <Button variant="primary" onClick={() => setUpdating(true)}>
          {t("base.update", { base: status.baseBranch })}
        </Button>
        <Button onClick={() => dismiss(repo, status)}>{t("base.later")}</Button>
      </div>
      {dialog}
    </div>
  );
}

/**
 * Brings the default branch into the current one by merging, or for a
 * branch not on the remote yet, rebasing. Fetches first, quietly, so the
 * preview is current.
 */
export function UpdateFromBaseDialog({
  repo,
  branch,
  onClose,
}: {
  repo: string;
  branch: string;
  onClose: () => void;
}) {
  const { t } = useTranslation(["branches", "common"]);
  const base = useBaseStatus(repo);
  const files = useStatus(repo).data?.files ?? [];
  const remote = useRemoteInfo(repo).data?.defaultRemote ?? null;
  const sync = useSyncActions(repo);
  const { updateFrom } = useBranchActions(repo);
  const { showInfo, showErrorWithAction } = useNotify();
  const [mode, setMode] = useState<UpdateMode>("merge");
  const [error, setError] = useState<AppError>();

  // Once, as soon as the remote is known; a failed fetch leaves the last
  // one's picture.
  const fetched = useRef(false);
  useEffect(() => {
    if (!remote || fetched.current) return;
    fetched.current = true;
    void sync.run({ action: "fetch", remote, background: true }).catch(() => {});
  }, [remote, sync]);

  const status: BaseStatus | null | undefined = base.data;
  const published = status?.published ?? true;
  const chosen: UpdateMode = published ? "merge" : mode;
  const conflicts = status?.conflicts;
  const busy = updateFrom.isPending;

  const submit = () => {
    if (!status || busy || status.behind === 0) return;
    setError(undefined);
    updateFrom.mutate(
      { base: status.base, mode: chosen },
      {
        onSuccess: (outcome) => {
          onClose();
          showInfo(
            outcome === "up_to_date"
              ? t("merge.resultUpToDate", { into: branch })
              : outcome === "rebased"
                ? t("merge.resultRebased", { into: branch, from: status.base })
                : t("merge.resultMerged", { from: status.base, into: branch }),
          );
        },
        onError: (e) => {
          const kind = toAppError(e).kind;
          // It stopped with the conflicts in place: the conflict banner
          // takes over from here.
          if (kind === "merge_conflict" || kind === "rebase_conflict") {
            onClose();
            showErrorWithAction(e, {
              label: t("common:fix.resolveConflicts"),
              run: () => runCommand("view.changes"),
            });
          } else {
            setError(toAppError(e));
          }
        },
      },
    );
  };

  const hasConflicts = (conflicts?.length ?? 0) > 0;
  return (
    <FormDialog
      open
      onOpenChange={(open) => !open && !busy && onClose()}
      title={t("base.title", { base: status?.baseBranch ?? "" })}
      description={
        status &&
        (status.behind === 0
          ? t("merge.upToDate", { from: status.base, into: branch })
          : t("merge.preview", { count: status.behind, from: status.base, into: branch }))
      }
      onSubmit={submit}
      dismissible={!busy}
      footer={
        <>
          <Button onClick={onClose} disabled={busy} autoFocus>
            {t("form.cancel")}
          </Button>
          <Button type="submit" variant="primary" disabled={!status || busy || status.behind === 0}>
            {hasConflicts
              ? t(chosen === "rebase" ? "base.rebaseConflicts" : "merge.submitConflicts")
              : t(chosen === "rebase" ? "base.rebase" : "base.merge")}
          </Button>
        </>
      }
    >
      {status && status.behind > 0 && conflicts !== undefined && (
        // Rebasing replays commits one by one, so it may conflict more.
        <ConflictPreview conflicts={conflicts} estimate={chosen === "rebase"} />
      )}
      <div className={styles.modes}>
        <RadioGroup.Root
          className={segmented.track}
          aria-label={t("base.mode")}
          value={chosen}
          onValueChange={(value) => setMode(value as UpdateMode)}
          disabled={published}
        >
          {(["merge", "rebase"] as const).map((m) => (
            <RadioGroup.Item key={m} value={m} className={segmented.segment}>
              {t(`base.modes.${m}`)}
            </RadioGroup.Item>
          ))}
        </RadioGroup.Root>
        <p className={styles.hint}>
          {published ? t("base.publishedMerges") : t(`base.modeHints.${chosen}`)}
        </p>
      </div>
      {files.length > 0 && <p className={styles.hint}>{t("base.autostash")}</p>}
      {error && <ErrorMessage error={error} />}
    </FormDialog>
  );
}

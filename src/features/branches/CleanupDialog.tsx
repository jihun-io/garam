import { useState } from "react";
import { useTranslation } from "react-i18next";

import { ErrorMessage } from "../../components/ErrorMessage";
import { Button } from "../../components/ui/Button";
import { Checkbox } from "../../components/ui/Checkbox";
import { FormDialog } from "../../components/ui/Dialog";
import { Loading } from "../../components/ui/Loading";
import { toAppError, type CleanupCandidate } from "../../ipc";
import { useRelativeTime } from "../../lib/time";
import { useNotify } from "../notify/notifyStore";
import { useBranchActions, useCleanupCandidates } from "./api";
import styles from "./branches.module.css";

/**
 * Whether a branch is ticked to begin with: only when deleting it can't
 * lose commits, which a branch gone from the remote but never merged can.
 */
export const safeToDelete = (c: CleanupCandidate) => c.unmerged === 0;

/**
 * Branches merged into the default branch or deleted on the remote, to
 * delete together. The notice afterwards can bring them back.
 */
export function CleanupDialog({ repo, onClose }: { repo: string; onClose: () => void }) {
  const { t } = useTranslation("branches");
  const relativeTime = useRelativeTime();
  const candidates = useCleanupCandidates(repo);
  const { deleteMany, restore } = useBranchActions(repo);
  const { showInfo, showError } = useNotify();
  // Unticked by the user, or ticked though risky; the rest follow the default.
  const [toggled, setToggled] = useState<Set<string>>(new Set());

  const list = candidates.data ?? [];
  const isChosen = (c: CleanupCandidate) => safeToDelete(c) !== toggled.has(c.name);
  const chosen = list.filter(isChosen).map((c) => c.name);
  const busy = deleteMany.isPending;

  const toggle = (name: string) =>
    setToggled((old) => {
      const next = new Set(old);
      if (!next.delete(name)) next.add(name);
      return next;
    });

  const submit = () => {
    if (busy || chosen.length === 0) return;
    deleteMany.mutate(chosen, {
      onSuccess: (deleted) => {
        onClose();
        showInfo(t("cleanup.done", { count: deleted.length }), {
          label: t("cleanup.undo"),
          // The dialog is gone by now, and react-query drops a mutate
          // call's own callbacks once its component unmounts; the
          // promise still settles.
          run: () =>
            void restore
              .mutateAsync(deleted)
              .then(() => showInfo(t("cleanup.restored", { count: deleted.length })), showError),
        });
      },
    });
  };

  return (
    <FormDialog
      open
      onOpenChange={(open) => !open && !busy && onClose()}
      title={t("cleanup.title")}
      description={list.length > 0 ? t("cleanup.intro") : undefined}
      onSubmit={submit}
      dismissible={!busy}
      footer={
        <>
          <Button onClick={onClose} disabled={busy} autoFocus>
            {t("form.cancel")}
          </Button>
          {list.length > 0 && (
            <Button type="submit" variant="danger" disabled={busy || chosen.length === 0}>
              {t("cleanup.submit", { count: chosen.length })}
            </Button>
          )}
        </>
      }
    >
      {candidates.isPending ? (
        <Loading />
      ) : candidates.isError ? (
        <ErrorMessage error={toAppError(candidates.error)} />
      ) : list.length === 0 ? (
        <p>{t("cleanup.none")}</p>
      ) : (
        <ul className={styles.cleanupList}>
          {list.map((c) => (
            <li key={c.name}>
              <label className={styles.cleanupRow}>
                <Checkbox
                  state={isChosen(c) ? "checked" : "unchecked"}
                  disabled={busy}
                  onChange={() => toggle(c.name)}
                />
                <span className={styles.cleanupText}>
                  <span className={styles.cleanupName}>{c.name}</span>
                  <span className={styles.hint}>
                    {t(`cleanup.reasons.${c.reason}`)} · {relativeTime(c.committedAt)}
                  </span>
                  {c.unmerged !== 0 && (
                    <span className={styles.cleanupWarning}>
                      {c.unmerged === null
                        ? t("cleanup.unknownUnmerged")
                        : t("cleanup.unmerged", { count: c.unmerged })}
                    </span>
                  )}
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
      {deleteMany.error && <ErrorMessage error={toAppError(deleteMany.error)} />}
    </FormDialog>
  );
}

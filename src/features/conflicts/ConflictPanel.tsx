import { useState } from "react";
import { useTranslation } from "react-i18next";

import { ErrorMessage } from "../../components/ErrorMessage";
import { Icon } from "../../components/Icon";
import { Button } from "../../components/ui/Button";
import { FormDialog } from "../../components/ui/Dialog";
import { toAppError, type ConflictState, type Operation } from "../../ipc";
import { useNotify } from "../notify/notifyStore";
import { useConflictActions } from "./api";
import styles from "./Conflicts.module.css";

/** Shown at the top of the changes list while an operation is stopped. */
export function ConflictBanner({ state }: { state: ConflictState }) {
  const { t } = useTranslation("conflicts");
  if (!state.operation) return null;
  const remaining = state.files.length;
  return (
    <div className={styles.banner} role="status">
      <p className={styles.bannerTitle}>
        <Icon name="conflicted" className={styles.bannerIcon} />
        {t(`operation.${state.operation}`)}
      </p>
      <p>{remaining > 0 ? t("remaining", { count: remaining }) : t("ready")}</p>
    </div>
  );
}

/** Takes the commit form's place: continue once resolved, or abort. */
export function ConflictPanel({ repo, state }: { repo: string; state: ConflictState }) {
  const { t } = useTranslation("conflicts");
  const { continueOperation } = useConflictActions(repo);
  const { showError, showInfo } = useNotify();
  const [aborting, setAborting] = useState(false);
  const operation = state.operation;
  if (!operation) return null;

  const finish = () =>
    continueOperation.mutate(undefined, {
      onSuccess: () => showInfo(t(`done.${operation}`)),
      onError: showError,
    });

  return (
    <div className={styles.panel}>
      <Button
        variant="primary"
        className={styles.continue}
        disabled={state.files.length > 0 || continueOperation.isPending}
        onClick={finish}
      >
        {t(`continue.${operation}`)}
      </Button>
      <Button onClick={() => setAborting(true)} disabled={continueOperation.isPending}>
        {t("abort.button")}
      </Button>
      {aborting && (
        <AbortDialog repo={repo} operation={operation} onClose={() => setAborting(false)} />
      )}
    </div>
  );
}

function AbortDialog({
  repo,
  operation,
  onClose,
}: {
  repo: string;
  operation: Operation;
  onClose: () => void;
}) {
  const { t } = useTranslation("conflicts");
  const { abort } = useConflictActions(repo);
  const showInfo = useNotify((s) => s.showInfo);

  return (
    <FormDialog
      open
      onOpenChange={(open) => !open && !abort.isPending && onClose()}
      title={t(`abort.title.${operation}`)}
      onSubmit={() =>
        abort.mutate(undefined, {
          onSuccess: () => {
            showInfo(t("done.aborted"));
            onClose();
          },
        })
      }
      dismissible={!abort.isPending}
      footer={
        <>
          <Button onClick={onClose} disabled={abort.isPending} autoFocus>
            {t("abort.keep")}
          </Button>
          <Button type="submit" variant="danger" disabled={abort.isPending}>
            {t(`abort.confirm.${operation}`)}
          </Button>
        </>
      }
    >
      <p>{t("abort.body")}</p>
      {abort.error && <ErrorMessage error={toAppError(abort.error)} />}
    </FormDialog>
  );
}

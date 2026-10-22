import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { ErrorMessage } from "../../../components/ErrorMessage";
import { Button } from "../../../components/ui/Button";
import { FormDialog } from "../../../components/ui/Dialog";
import { Field } from "../../../components/ui/Field";
import { commands, toAppError, unwrap, type AppError, type Progress } from "../../../ipc";
import { joinPath, repoNameFromUrl } from "../../../lib/paths";
import { networkChannel } from "../../sync/networkChannel";
import { rememberParentDir } from "../defaultParent";
import { BrowseButton } from "./BrowseButton";
import styles from "./dialogs.module.css";
import { useParentDir } from "./useParentDir";

type CloneState = { status: "form" } | { status: "cloning"; progress: Progress | null };

export function CloneRepositoryDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation("repos");
  const queryClient = useQueryClient();
  const [url, setUrl] = useState("");
  // Follows the URL until the user types their own name.
  const [customName, setCustomName] = useState<string | null>(null);
  const [parent, setParent] = useParentDir();
  const [error, setError] = useState<AppError>();
  const [state, setState] = useState<CloneState>({ status: "form" });
  const operationId = useRef<string | null>(null);

  const name = customName ?? repoNameFromUrl(url);
  const cloning = state.status === "cloning";
  const ready = url.trim() !== "" && name.trim() !== "" && parent !== "" && !cloning;

  const submit = async () => {
    if (!ready) return;
    const id = crypto.randomUUID();
    operationId.current = id;
    setError(undefined);
    setState({ status: "cloning", progress: null });

    const channel = networkChannel((progress) => {
      if (operationId.current === id) setState({ status: "cloning", progress });
    });
    try {
      await unwrap(commands.repoClone(id, url.trim(), parent, name.trim(), channel));
      rememberParentDir(parent);
      await queryClient.invalidateQueries({ queryKey: ["repositories"] });
      onClose();
    } catch (e) {
      const appError = toAppError(e);
      // A cancel is the user's own choice: go back to the form quietly.
      if (appError.kind !== "cancelled") setError(appError);
      setState({ status: "form" });
    } finally {
      operationId.current = null;
    }
  };

  const cancelClone = () => {
    if (operationId.current) void commands.operationCancel(operationId.current);
  };

  const footer = cloning ? (
    // Focus moves here when the form is replaced by the progress view.
    <Button onClick={cancelClone} autoFocus>
      {t("clone.cancelClone")}
    </Button>
  ) : (
    <>
      <Button onClick={onClose}>{t("form.cancel")}</Button>
      <Button type="submit" variant="primary" disabled={!ready}>
        {t("clone.submit")}
      </Button>
    </>
  );

  return (
    <FormDialog
      open
      onOpenChange={(open) => !open && !cloning && onClose()}
      title={t("clone.title")}
      onSubmit={() => void submit()}
      dismissible={!cloning}
      footer={footer}
    >
      {cloning ? (
        <CloneProgress name={name.trim()} progress={state.progress} />
      ) : (
        <>
          <Field
            label={t("clone.url")}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            hint={t("clone.urlHint")}
            autoFocus
            inputMode="url"
          />
          <Field
            label={t("clone.name")}
            value={name}
            onChange={(e) => setCustomName(e.target.value)}
          />
          <Field
            label={t("clone.parent")}
            value={parent}
            onChange={(e) => setParent(e.target.value)}
            trailing={<BrowseButton current={parent} onChoose={setParent} />}
            hint={
              name.trim() && parent
                ? t("form.willBeCreatedAt", { path: joinPath(parent, name.trim()) })
                : undefined
            }
          />
          {error && <ErrorMessage error={error} />}
        </>
      )}
    </FormDialog>
  );
}

function CloneProgress({ name, progress }: { name: string; progress: Progress | null }) {
  const { t } = useTranslation("repos");
  const percent = progress?.overallPercent ?? 0;
  const phase = progress ? t(`clone.phase.${progress.phase}`) : t("clone.phase.starting");

  return (
    <div className={styles.progress}>
      <p className={styles.progressTitle}>{t("clone.cloning", { name })}</p>
      <div
        className={styles.bar}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={`${phase} ${percent}%`}
      >
        <div className={styles.barFill} style={{ width: `${percent}%` }} />
      </div>
      <p className={styles.progressPhase}>
        <span>{phase}</span>
        <span>{percent}%</span>
      </p>
    </div>
  );
}

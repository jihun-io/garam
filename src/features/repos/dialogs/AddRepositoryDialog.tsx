import { useState } from "react";
import { useTranslation } from "react-i18next";

import { ErrorMessage } from "../../../components/ErrorMessage";
import { Button } from "../../../components/ui/Button";
import { FormDialog } from "../../../components/ui/Dialog";
import { Field } from "../../../components/ui/Field";
import { toAppError, type AppError, type RepositoryEntry } from "../../../ipc";
import { useRepositoryActions } from "../api";
import { useOpenRepository } from "../openRepository";
import { BrowseButton } from "./BrowseButton";
import styles from "./dialogs.module.css";

export function AddRepositoryDialog({
  initialPath = "",
  initialError,
  onClose,
}: {
  initialPath?: string;
  initialError?: AppError;
  onClose: () => void;
}) {
  const { t } = useTranslation("repos");
  const { add, initExisting } = useRepositoryActions();
  const openRepository = useOpenRepository();
  const [path, setPath] = useState(initialPath);
  const [error, setError] = useState<AppError | undefined>(initialError);
  const busy = add.isPending || initExisting.isPending;

  const added = (entry: RepositoryEntry) => {
    onClose();
    void openRepository(entry.path);
  };

  const submit = () => {
    if (!path.trim() || busy) return;
    setError(undefined);
    add.mutate(path.trim(), { onSuccess: added, onError: (e) => setError(toAppError(e)) });
  };

  const initHere = () => {
    setError(undefined);
    initExisting.mutate(path.trim(), {
      onSuccess: added,
      onError: (e) => setError(toAppError(e)),
    });
  };

  return (
    <FormDialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={t("add.title")}
      onSubmit={submit}
      footer={
        <>
          <Button onClick={onClose}>{t("form.cancel")}</Button>
          <Button type="submit" variant="primary" disabled={!path.trim() || busy}>
            {t("add.submit")}
          </Button>
        </>
      }
    >
      <Field
        label={t("add.path")}
        value={path}
        onChange={(e) => {
          setPath(e.target.value);
          setError(undefined);
        }}
        autoFocus
        trailing={
          <BrowseButton
            current={path}
            disabled={busy}
            onChoose={(dir) => {
              setPath(dir);
              setError(undefined);
            }}
          />
        }
      />
      {error && <ErrorMessage error={error} />}
      {error?.kind === "not_a_repository" && (
        <div className={styles.offer}>
          <p>{t("add.initOffer")}</p>
          <Button onClick={initHere} disabled={busy}>
            {t("add.initSubmit")}
          </Button>
        </div>
      )}
    </FormDialog>
  );
}

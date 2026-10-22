import { useState } from "react";
import { useTranslation } from "react-i18next";

import { ErrorMessage } from "../../../components/ErrorMessage";
import { Button } from "../../../components/ui/Button";
import { FormDialog } from "../../../components/ui/Dialog";
import { Field } from "../../../components/ui/Field";
import { joinPath } from "../../../lib/paths";
import { toAppError, type AppError } from "../../../ipc";
import { useRepositoryActions } from "../api";
import { rememberParentDir } from "../defaultParent";
import { useOpenRepository } from "../openRepository";
import { BrowseButton } from "./BrowseButton";
import { useParentDir } from "./useParentDir";

export function CreateRepositoryDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation("repos");
  const { create } = useRepositoryActions();
  const openRepository = useOpenRepository();
  const [name, setName] = useState("");
  const [parent, setParent] = useParentDir();
  const [error, setError] = useState<AppError>();
  const ready = name.trim() !== "" && parent !== "" && !create.isPending;

  const submit = () => {
    if (!ready) return;
    setError(undefined);
    create.mutate(
      { parent, name: name.trim() },
      {
        onSuccess: (entry) => {
          rememberParentDir(parent);
          onClose();
          void openRepository(entry.path);
        },
        onError: (e) => setError(toAppError(e)),
      },
    );
  };

  return (
    <FormDialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={t("create.title")}
      onSubmit={submit}
      footer={
        <>
          <Button onClick={onClose}>{t("form.cancel")}</Button>
          <Button type="submit" variant="primary" disabled={!ready}>
            {t("create.submit")}
          </Button>
        </>
      }
    >
      <Field
        label={t("create.name")}
        value={name}
        onChange={(e) => setName(e.target.value)}
        autoFocus
      />
      <Field
        label={t("create.parent")}
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
    </FormDialog>
  );
}

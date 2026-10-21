import { useState } from "react";
import { useTranslation } from "react-i18next";

import { ErrorMessage } from "../../components/ErrorMessage";
import { Button } from "../../components/ui/Button";
import { FormDialog } from "../../components/ui/Dialog";
import { toAppError, type AppError, type Branch } from "../../ipc";

/** Confirms deletion; if git says the branch is unmerged, asks once more. */
export function DeleteBranchDialog({
  branch,
  onDelete,
  onClose,
}: {
  branch: Branch;
  onDelete: (force: boolean) => Promise<unknown>;
  onClose: () => void;
}) {
  const { t } = useTranslation("branches");
  const [unmerged, setUnmerged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AppError>();

  const submit = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await onDelete(unmerged);
      onClose();
    } catch (e) {
      const appError = toAppError(e);
      if (appError.kind === "branch_not_merged") setUnmerged(true);
      else setError(appError);
    } finally {
      setBusy(false);
    }
  };

  return (
    <FormDialog
      open
      onOpenChange={(open) => !open && !busy && onClose()}
      title={
        unmerged
          ? t("delete.unmergedTitle", { branch: branch.name })
          : t("delete.title", { branch: branch.name })
      }
      onSubmit={() => void submit()}
      footer={
        <>
          <Button onClick={onClose} disabled={busy} autoFocus>
            {t("delete.cancel")}
          </Button>
          <Button type="submit" variant="danger" disabled={busy}>
            {unmerged ? t("delete.forceSubmit") : t("delete.submit")}
          </Button>
        </>
      }
    >
      <p>{unmerged ? t("delete.unmergedBody") : t("delete.body")}</p>
      {error && <ErrorMessage error={error} />}
    </FormDialog>
  );
}

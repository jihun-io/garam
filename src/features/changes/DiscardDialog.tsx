import { useTranslation } from "react-i18next";

import { ErrorMessage } from "../../components/ErrorMessage";
import { Button } from "../../components/ui/Button";
import { FormDialog } from "../../components/ui/Dialog";
import { toAppError, type FileChange } from "../../ipc";
import { useChangeActions } from "./api";
import { splitPath } from "./fileState";

export function DiscardDialog({
  repo,
  files,
  onClose,
}: {
  repo: string;
  files: FileChange[];
  onClose: () => void;
}) {
  const { t } = useTranslation("changes");
  const { discard } = useChangeActions(repo);

  return (
    <FormDialog
      open
      onOpenChange={(open) => !open && !discard.isPending && onClose()}
      title={t("discard.title")}
      onSubmit={() => discard.mutate(files, { onSuccess: onClose })}
      dismissible={!discard.isPending}
      footer={
        <>
          <Button onClick={onClose} disabled={discard.isPending} autoFocus>
            {t("discard.keep")}
          </Button>
          <Button type="submit" variant="danger" disabled={discard.isPending}>
            {t("discard.confirm")}
          </Button>
        </>
      }
    >
      <p>
        {files.length === 1
          ? t("discard.single", { name: splitPath(files[0].path).name })
          : t("discard.multiple", { count: files.length })}
      </p>
      <p>{t("discard.trash")}</p>
      {discard.error && <ErrorMessage error={toAppError(discard.error)} />}
    </FormDialog>
  );
}

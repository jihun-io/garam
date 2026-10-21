import { useState } from "react";
import { useTranslation } from "react-i18next";

import { ErrorMessage } from "../../components/ErrorMessage";
import { Button } from "../../components/ui/Button";
import { FormDialog } from "../../components/ui/Dialog";
import { Field } from "../../components/ui/Field";
import { toAppError, type AppError } from "../../ipc";
import { sanitizeBranchName } from "./branchName";

/** Name input shared by "create branch" and "rename branch". */
export function BranchNameDialog({
  title,
  label,
  submitLabel,
  initialName = "",
  note,
  onSubmit,
  onClose,
}: {
  title: string;
  label: string;
  submitLabel: string;
  initialName?: string;
  note?: string;
  onSubmit: (name: string) => Promise<unknown>;
  onClose: () => void;
}) {
  const { t } = useTranslation("branches");
  const [input, setInput] = useState(initialName);
  const [error, setError] = useState<AppError>();
  const [busy, setBusy] = useState(false);
  const name = sanitizeBranchName(input);
  const ready = name !== "" && name !== initialName && !busy;

  const submit = async () => {
    if (!ready) return;
    setBusy(true);
    setError(undefined);
    try {
      await onSubmit(name);
      onClose();
    } catch (e) {
      setError(toAppError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <FormDialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={title}
      onSubmit={() => void submit()}
      footer={
        <>
          <Button onClick={onClose}>{t("form.cancel")}</Button>
          <Button type="submit" variant="primary" disabled={!ready}>
            {submitLabel}
          </Button>
        </>
      }
    >
      <Field
        label={label}
        value={input}
        onChange={(e) => {
          setInput(e.target.value);
          setError(undefined);
        }}
        autoFocus
        hint={name && name !== input.trim() ? t("create.willBe", { name }) : undefined}
      />
      {note && <p>{note}</p>}
      {error && <ErrorMessage error={error} />}
    </FormDialog>
  );
}

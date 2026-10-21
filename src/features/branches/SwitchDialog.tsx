import { useId, useState } from "react";
import { useTranslation } from "react-i18next";

import { ErrorMessage } from "../../components/ErrorMessage";
import { Button } from "../../components/ui/Button";
import { FormDialog } from "../../components/ui/Dialog";
import { toAppError, type Branch, type SwitchMode } from "../../ipc";
import styles from "./branches.module.css";

/** Asked when switching with uncommitted changes. */
export function SwitchDialog({
  target,
  current,
  onSwitch,
  onClose,
}: {
  target: Branch;
  current: string | null;
  onSwitch: (mode: SwitchMode) => Promise<unknown>;
  onClose: () => void;
}) {
  const { t } = useTranslation("branches");
  const name = useId();
  const [mode, setMode] = useState<SwitchMode>("leave_changes");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ReturnType<typeof toAppError>>();
  const from = current ?? t("picker.detached");

  const submit = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await onSwitch(mode);
      onClose();
    } catch (e) {
      setError(toAppError(e));
    } finally {
      setBusy(false);
    }
  };

  const option = (value: SwitchMode, label: string, hint: string) => (
    <label className={styles.option}>
      <input
        type="radio"
        name={name}
        value={value}
        checked={mode === value}
        onChange={() => setMode(value)}
      />
      <span>
        <span className={styles.optionLabel}>{label}</span>
        <span className={styles.optionHint}>{hint}</span>
      </span>
    </label>
  );

  return (
    <FormDialog
      open
      onOpenChange={(open) => !open && !busy && onClose()}
      title={t("switch.title", { branch: target.name })}
      onSubmit={() => void submit()}
      dismissible={!busy}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            {t("switch.cancel")}
          </Button>
          <Button type="submit" variant="primary" disabled={busy}>
            {t("switch.submit")}
          </Button>
        </>
      }
    >
      <p>{t("switch.body")}</p>
      <fieldset className={styles.options}>
        {option(
          "leave_changes",
          t("switch.leave", { branch: from }),
          t("switch.leaveHint", { branch: from }),
        )}
        {option("bring_changes", t("switch.bring", { branch: target.name }), t("switch.bringHint"))}
      </fieldset>
      {error && <ErrorMessage error={error} />}
    </FormDialog>
  );
}

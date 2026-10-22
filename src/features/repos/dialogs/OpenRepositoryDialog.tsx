import { useId, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "../../../components/ui/Button";
import { Checkbox } from "../../../components/ui/Checkbox";
import { FormDialog } from "../../../components/ui/Dialog";
import { useNotify } from "../../notify/notifyStore";
import { useUpdateSettings } from "../../settings/api";
import { useRepositories } from "../api";
import { useOpenIn, useOpenPrompt, type OpenTarget } from "../openRepository";
import styles from "./dialogs.module.css";

/** Asks whether a repository opens in this window or a new one. */
export function OpenRepositoryDialog() {
  const { path, close } = useOpenPrompt();
  if (!path) return null;
  // Remount for each repository so the checkbox starts clear.
  return <OpenRepositoryPrompt key={path} path={path} onClose={close} />;
}

function OpenRepositoryPrompt({ path, onClose }: { path: string; onClose: () => void }) {
  const { t } = useTranslation("repos");
  const [remember, setRemember] = useState(false);
  const rememberId = useId();
  const openIn = useOpenIn();
  const updateSettings = useUpdateSettings();
  const showError = useNotify((s) => s.showError);
  const name = useRepositories().data?.repositories.find((r) => r.path === path)?.name ?? path;

  const choose = (target: OpenTarget) => {
    if (remember) updateSettings({ openRepositoryIn: target });
    onClose();
    openIn(path, target).catch(showError);
  };

  return (
    <FormDialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={t("openIn.title", { name })}
      onSubmit={() => choose("new_window")}
      footer={
        <>
          <Button onClick={onClose}>{t("form.cancel")}</Button>
          <Button onClick={() => choose("current_window")}>{t("openIn.currentWindow")}</Button>
          <Button type="submit" variant="primary" autoFocus>
            {t("openIn.newWindow")}
          </Button>
        </>
      }
    >
      <p>{t("openIn.body")}</p>
      <div className={styles.remember}>
        <label className={styles.rememberOption} htmlFor={rememberId}>
          <Checkbox
            id={rememberId}
            state={remember ? "checked" : "unchecked"}
            onChange={(e) => setRemember(e.target.checked)}
          />
          {t("openIn.remember")}
        </label>
        {remember && <p className={styles.rememberHint}>{t("openIn.rememberHint")}</p>}
      </div>
    </FormDialog>
  );
}

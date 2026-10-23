import { useState } from "react";
import { useTranslation } from "react-i18next";

import { ErrorMessage } from "../../components/ErrorMessage";
import { Button } from "../../components/ui/Button";
import { Checkbox } from "../../components/ui/Checkbox";
import { FormDialog } from "../../components/ui/Dialog";
import { Field } from "../../components/ui/Field";
import { toAppError, type AppError } from "../../ipc";
import { splitPath } from "../changes/fileState";
import { useNotify } from "../notify/notifyStore";
import { useStashActions } from "./api";
import styles from "./Stashes.module.css";

/**
 * Puts changes aside: all of them, or only `paths`. Untracked files go
 * too unless the box is cleared.
 */
export function StashDialog({
  repo,
  paths,
  onClose,
}: {
  repo: string;
  /** Only these files; all changes when empty. */
  paths: string[];
  onClose: () => void;
}) {
  const { t } = useTranslation("stashes");
  const { push } = useStashActions(repo);
  const showInfo = useNotify((s) => s.showInfo);
  const [message, setMessage] = useState("");
  const [includeUntracked, setIncludeUntracked] = useState(true);
  const [error, setError] = useState<AppError>();

  const submit = () =>
    push.mutate(
      { message: message.trim(), includeUntracked, paths },
      {
        onSuccess: () => {
          showInfo(t("done.pushed"));
          onClose();
        },
        onError: (e) => setError(toAppError(e)),
      },
    );

  return (
    <FormDialog
      open
      onOpenChange={(open) => !open && !push.isPending && onClose()}
      title={t(paths.length > 0 ? "push.titleFiles" : "push.title")}
      onSubmit={submit}
      dismissible={!push.isPending}
      footer={
        <>
          <Button onClick={onClose} disabled={push.isPending}>
            {t("push.cancel")}
          </Button>
          <Button type="submit" variant="primary" disabled={push.isPending}>
            {t("push.submit")}
          </Button>
        </>
      }
    >
      <p>
        {paths.length > 0
          ? t("push.bodyFiles", { count: paths.length, name: splitPath(paths[0]).name })
          : t("push.body")}
      </p>
      <Field
        label={t("push.message")}
        placeholder={t("push.messagePlaceholder")}
        value={message}
        onChange={(e) => {
          setMessage(e.target.value);
          setError(undefined);
        }}
        // Enter that finishes composing Korean text mustn't submit the form.
        onKeyDown={(e) => {
          if (e.key === "Enter" && e.nativeEvent.isComposing) e.preventDefault();
        }}
        autoFocus
      />
      <label className={styles.untracked}>
        <Checkbox
          state={includeUntracked ? "checked" : "unchecked"}
          onChange={(e) => setIncludeUntracked(e.target.checked)}
        />
        {t("push.untracked")}
      </label>
      {error && <ErrorMessage error={error} />}
    </FormDialog>
  );
}

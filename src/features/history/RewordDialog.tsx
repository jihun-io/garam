import { useId, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";

import { ErrorMessage } from "../../components/ErrorMessage";
import { Button } from "../../components/ui/Button";
import { FormDialog } from "../../components/ui/Dialog";
import { Field } from "../../components/ui/Field";
import fieldStyles from "../../components/ui/Field.module.css";
import { Loading } from "../../components/ui/Loading";
import { toAppError, type CommitSummary } from "../../ipc";
import { shortHash } from "../../lib/hash";
import { useNotify } from "../notify/notifyStore";
import { useCommitActions, useCommitDetail } from "./api";
import styles from "./History.module.css";

type Props = {
  repo: string;
  commit: CommitSummary;
  head: string;
  branch: string;
  onClose: () => void;
  onReword: (oid: string) => void;
};

/** Keep one dialog mounted while the complete message, including trailers, loads. */
export function RewordDialog({ repo, commit, head, branch, onClose, onReword }: Props) {
  const { t } = useTranslation("history");
  const descriptionId = useId();
  const detail = useCommitDetail(repo, commit.oid);
  const [draft, setDraft] = useState<{ summary: string; description: string } | null>(null);
  if (detail.data && draft === null) {
    setDraft({ summary: detail.data.summary, description: detail.data.body });
  }
  const summary = draft?.summary ?? "";
  const description = draft?.description ?? "";
  const { reword } = useCommitActions(repo);
  const showInfo = useNotify((s) => s.showInfo);
  const message = description.trim()
    ? `${summary.trim()}\n\n${description.trim()}`
    : summary.trim();
  const original = detail.data?.body.trim()
    ? `${detail.data.summary}\n\n${detail.data.body.trim()}`
    : detail.data?.summary;
  const canSubmit =
    draft !== null && summary.trim() !== "" && message !== original && !reword.isPending;
  const submit = () => {
    if (!canSubmit) return;
    reword.mutate(
      { oid: commit.oid, head, branch, message },
      {
        onSuccess: (oid) => {
          onReword(oid);
          showInfo(t("done.reworded"));
          onClose();
        },
      },
    );
  };
  const keyDown = (event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (event.key !== "Enter") return;
    // WebKit may report the Enter ending a composition only as keyCode 229.
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) {
      event.preventDefault();
      return;
    }
    if (event.metaKey || event.ctrlKey) {
      event.preventDefault();
      submit();
    }
  };
  return (
    <FormDialog
      open
      onOpenChange={(open) => !open && !reword.isPending && onClose()}
      title={t("reword.title")}
      description={shortHash(commit.oid)}
      onSubmit={submit}
      dismissible={!reword.isPending}
      footer={
        <>
          <Button onClick={onClose} disabled={reword.isPending}>
            {t("reword.cancel")}
          </Button>
          <Button type="submit" variant="primary" disabled={!canSubmit}>
            {t("reword.submit")}
          </Button>
        </>
      }
    >
      {draft ? (
        <>
          <p>{t("reword.body")}</p>
          <Field
            label={t("reword.summary")}
            value={summary}
            onChange={(e) => setDraft({ ...draft, summary: e.target.value })}
            onKeyDown={keyDown}
            disabled={reword.isPending}
            autoFocus
          />
          <div className={fieldStyles.field}>
            <label htmlFor={descriptionId} className={fieldStyles.label}>
              {t("reword.description")}
            </label>
            <textarea
              id={descriptionId}
              className={`${fieldStyles.input} ${styles.squashDescription}`}
              value={description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              onKeyDown={keyDown}
              disabled={reword.isPending}
              rows={5}
            />
          </div>
          <p className={styles.dialogNote}>{t("reword.recover")}</p>
        </>
      ) : detail.error ? (
        <ErrorMessage error={toAppError(detail.error)} />
      ) : (
        <Loading />
      )}
      {reword.error && <ErrorMessage error={toAppError(reword.error)} />}
    </FormDialog>
  );
}

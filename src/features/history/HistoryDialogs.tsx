import { useId, useState } from "react";
import { useTranslation } from "react-i18next";

import { ErrorMessage } from "../../components/ErrorMessage";
import { Button } from "../../components/ui/Button";
import { FormDialog } from "../../components/ui/Dialog";
import { Field } from "../../components/ui/Field";
import { toAppError, type AppError, type CommitSummary, type ResetMode } from "../../ipc";
import { shortHash } from "../../lib/hash";
import branchStyles from "../branches/branches.module.css";
import { useBranchDialog } from "../branches/branchDialogStore";
import { useStatus } from "../changes/api";
import { useNotify } from "../notify/notifyStore";
import { useCommitActions } from "./api";
import { useHistoryDialog } from "./historyDialogStore";

/** Renders whichever history dialog is open for `repo`. */
export function HistoryDialogs({ repo }: { repo: string }) {
  const { dialog, close } = useHistoryDialog();
  if (!dialog) return null;
  const props = { repo, commit: dialog.commit, onClose: close };
  switch (dialog.kind) {
    case "reset":
      return <ResetDialog {...props} />;
    case "checkout":
      return <CheckoutDialog {...props} />;
    case "tag":
      return <TagDialog {...props} />;
  }
}

type DialogProps = { repo: string; commit: CommitSummary; onClose: () => void };

/** Runs `action`, keeping the dialog open with the error if it fails. */
function useSubmit(action: () => Promise<unknown>, onDone: () => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AppError>();
  const submit = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await action();
      onDone();
    } catch (e) {
      setError(toAppError(e));
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, submit: () => void submit() };
}

const MODES: ResetMode[] = ["soft", "mixed", "hard"];

function ResetDialog({ repo, commit, onClose }: DialogProps) {
  const { t } = useTranslation("history");
  const name = useId();
  const status = useStatus(repo);
  const { reset } = useCommitActions(repo);
  const showInfo = useNotify((s) => s.showInfo);
  const [mode, setMode] = useState<ResetMode>("mixed");
  const { busy, error, submit } = useSubmit(
    () => reset.mutateAsync({ oid: commit.oid, mode }),
    () => {
      showInfo(t("done.reset", { summary: commit.summary }));
      onClose();
    },
  );
  const branch = status.data?.branch.head;
  const target = branch ? t("reset.current", { branch }) : t("reset.detached");
  const uncommitted = status.data?.files.filter((f) => f.staged || f.unstaged).length ?? 0;
  const hard = mode === "hard";

  return (
    <FormDialog
      open
      onOpenChange={(open) => !open && !busy && onClose()}
      title={t("reset.title")}
      onSubmit={submit}
      dismissible={!busy}
      footer={
        <>
          <Button onClick={onClose} disabled={busy} autoFocus>
            {t("reset.cancel")}
          </Button>
          <Button type="submit" variant={hard ? "danger" : "primary"} disabled={busy}>
            {hard ? t("reset.submitHard") : t("reset.submit")}
          </Button>
        </>
      }
    >
      <p>{t("reset.body", { target, summary: commit.summary, hash: shortHash(commit.oid) })}</p>
      <fieldset className={branchStyles.options}>
        {MODES.map((value) => (
          <label key={value} className={branchStyles.option}>
            <input
              type="radio"
              name={name}
              value={value}
              checked={mode === value}
              onChange={() => setMode(value)}
            />
            <span>
              <span className={branchStyles.optionLabel}>{t(`reset.modes.${value}`)}</span>
              <span className={branchStyles.optionHint}>{t(`reset.modes.${value}Hint`)}</span>
            </span>
          </label>
        ))}
      </fieldset>
      {hard && uncommitted > 0 && <p>{t("reset.uncommitted", { count: uncommitted })}</p>}
      {error && <ErrorMessage error={error} />}
    </FormDialog>
  );
}

function CheckoutDialog({ repo, commit, onClose }: DialogProps) {
  const { t } = useTranslation("history");
  const { checkout } = useCommitActions(repo);
  const openBranchDialog = useBranchDialog((s) => s.open);
  const showInfo = useNotify((s) => s.showInfo);
  const { busy, error, submit } = useSubmit(
    () => checkout.mutateAsync(commit.oid),
    () => {
      showInfo(t("done.checkedOut", { summary: commit.summary }));
      onClose();
    },
  );

  return (
    <FormDialog
      open
      onOpenChange={(open) => !open && !busy && onClose()}
      title={t("checkout.title")}
      onSubmit={submit}
      dismissible={!busy}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            {t("checkout.cancel")}
          </Button>
          <Button
            onClick={() => {
              onClose();
              openBranchDialog({ kind: "create", from: commit });
            }}
            disabled={busy}
          >
            {t("checkout.createBranch")}
          </Button>
          <Button type="submit" variant="primary" disabled={busy} autoFocus>
            {t("checkout.submit")}
          </Button>
        </>
      }
    >
      <p>{t("checkout.body", { summary: commit.summary, hash: shortHash(commit.oid) })}</p>
      {error && <ErrorMessage error={error} />}
    </FormDialog>
  );
}

function TagDialog({ repo, commit, onClose }: DialogProps) {
  const { t } = useTranslation("history");
  const { createTag } = useCommitActions(repo);
  const showInfo = useNotify((s) => s.showInfo);
  const [tagName, setTagName] = useState("");
  const [message, setMessage] = useState("");
  const name = tagName.trim();
  const { busy, error, submit } = useSubmit(
    () => createTag.mutateAsync({ name, oid: commit.oid, message }),
    () => {
      showInfo(t("done.tagged", { name }));
      onClose();
    },
  );

  return (
    <FormDialog
      open
      onOpenChange={(open) => !open && !busy && onClose()}
      title={t("tag.title")}
      onSubmit={() => name && submit()}
      dismissible={!busy}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            {t("tag.cancel")}
          </Button>
          <Button type="submit" variant="primary" disabled={busy || !name}>
            {t("tag.submit")}
          </Button>
        </>
      }
    >
      <p>{t("tag.for", { summary: commit.summary, hash: shortHash(commit.oid) })}</p>
      <Field
        label={t("tag.name")}
        value={tagName}
        onChange={(e) => setTagName(e.target.value)}
        autoFocus
      />
      <Field
        label={t("tag.message")}
        hint={t("tag.messageHint")}
        value={message}
        onChange={(e) => setMessage(e.target.value)}
      />
      {error && <ErrorMessage error={error} />}
    </FormDialog>
  );
}

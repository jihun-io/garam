import { useId, useState } from "react";
import { useTranslation } from "react-i18next";

import { ErrorMessage } from "../../components/ErrorMessage";
import { Button } from "../../components/ui/Button";
import { FormDialog } from "../../components/ui/Dialog";
import { Field } from "../../components/ui/Field";
import fieldStyles from "../../components/ui/Field.module.css";
import { Loading } from "../../components/ui/Loading";
import { Select, type SelectOption } from "../../components/ui/Select";
import {
  toAppError,
  type AppError,
  type Branch,
  type CommitSummary,
  type ResetMode,
} from "../../ipc";
import { shortHash } from "../../lib/hash";
import { useRelativeTime } from "../../lib/time";
import { useBranches } from "../branches/api";
import branchStyles from "../branches/branches.module.css";
import { useBranchDialog } from "../branches/branchDialogStore";
import { useStatus } from "../changes/api";
import { useNotify } from "../notify/notifyStore";
import { useCommitActions, useHistoryMarkers, useLostCommits } from "./api";
import { CommitTitle } from "./CommitTitle";
import styles from "./History.module.css";
import { useHistoryDialog } from "./historyDialogStore";
import { useHistoryPane } from "./historyPaneStore";

/** Renders whichever history dialog is open for `repo`. */
export function HistoryDialogs({ repo }: { repo: string }) {
  const { dialog, close } = useHistoryDialog();
  if (!dialog) return null;
  switch (dialog.kind) {
    case "reset":
      return <ResetDialog repo={repo} commit={dialog.commit} onClose={close} />;
    case "checkout":
      return <CheckoutDialog repo={repo} commit={dialog.commit} onClose={close} />;
    case "tag":
      return <TagDialog repo={repo} commit={dialog.commit} onClose={close} />;
    case "cherryPickOnto":
      return <CherryPickOntoDialog repo={repo} commits={dialog.commits} onClose={close} />;
    case "squash":
      return <SquashDialog repo={repo} commits={dialog.commits} onClose={close} />;
    case "compareBranch":
      return <CompareBranchDialog repo={repo} onClose={close} />;
    case "recover":
      return <RecoverDialog repo={repo} onClose={close} />;
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

/** Picks a branch to compare with the current one, three-dot. */
function CompareBranchDialog({ repo, onClose }: { repo: string; onClose: () => void }) {
  const { t } = useTranslation("history");
  const id = useId();
  const status = useStatus(repo);
  const branches = useBranches(repo);
  const showPane = useHistoryPane((s) => s.show);
  const current = status.data?.branch.head ?? null;
  const options: SelectOption<string>[] = (branches.data ?? [])
    .filter((b) => !(b.kind === "local" && b.name === current))
    .map((b) => ({ value: refName(b), label: b.name }));
  const [choice, setChoice] = useState<string | null>(null);
  const target = choice ?? options[0]?.value ?? null;
  const currentLabel = current ?? t("compareBranch.detached");

  const submit = () => {
    const head = status.data?.branch.oid;
    if (!target || !head) return;
    showPane(repo, {
      kind: "compare",
      base: current ? `refs/heads/${current}` : head,
      target,
      mode: "three_dot",
      baseLabel: currentLabel,
      targetLabel: options.find((o) => o.value === target)?.label ?? target,
    });
    onClose();
  };

  return (
    <FormDialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={t("compareBranch.title")}
      onSubmit={submit}
      footer={
        <>
          <Button onClick={onClose}>{t("compareBranch.cancel")}</Button>
          <Button type="submit" variant="primary" disabled={!target || !status.data?.branch.oid}>
            {t("compareBranch.submit")}
          </Button>
        </>
      }
    >
      <p>{t("compareBranch.body", { current: currentLabel })}</p>
      {target && (
        <div className={styles.filterRow}>
          <label className={styles.filterLabel} htmlFor={id}>
            {t("compareBranch.branch")}
          </label>
          <Select id={id} value={target} options={options} onChange={setChoice} />
        </div>
      )}
    </FormDialog>
  );
}

function refName(branch: Branch): string {
  return `refs/${branch.kind === "local" ? "heads" : "remotes"}/${branch.name}`;
}

/** Commits HEAD left behind, each one a branch away from coming back. */
function RecoverDialog({ repo, onClose }: { repo: string; onClose: () => void }) {
  const { t } = useTranslation("history");
  const relativeTime = useRelativeTime();
  const lost = useLostCommits(repo);
  const openBranchDialog = useBranchDialog((s) => s.open);
  const showPane = useHistoryPane((s) => s.show);

  let body;
  if (lost.isError) body = <ErrorMessage error={toAppError(lost.error)} />;
  else if (!lost.data) body = <Loading />;
  else if (lost.data.length === 0) body = <p>{t("recover.empty")}</p>;
  else {
    body = (
      <ul className={styles.lostList} aria-label={t("recover.list")}>
        {lost.data.map((entry) => (
          <li key={entry.oid} className={styles.lost}>
            <span className={styles.lostText}>
              <span className={styles.summary}>
                <CommitTitle summary={entry.summary} />
              </span>
              <span className={styles.meta}>
                {shortHash(entry.oid)} · {relativeTime(entry.visitedAt)} · {entry.action}
              </span>
            </span>
            <Button
              variant="ghost"
              onClick={() => {
                showPane(repo, { kind: "commit", oid: entry.oid });
                onClose();
              }}
            >
              {t("recover.view")}
            </Button>
            <Button
              onClick={() => {
                onClose();
                openBranchDialog({ kind: "create", from: entry });
              }}
            >
              {t("recover.createBranch")}
            </Button>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <FormDialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={t("recover.title")}
      onSubmit={onClose}
      footer={
        <Button type="submit" variant="primary">
          {t("recover.close")}
        </Button>
      }
    >
      <p>{t("recover.body")}</p>
      {body}
    </FormDialog>
  );
}

/** Asks for the combined commit's message before squashing. */
function SquashDialog({
  repo,
  commits,
  onClose,
}: {
  repo: string;
  /** Newest first. */
  commits: CommitSummary[];
  onClose: () => void;
}) {
  const { t } = useTranslation("history");
  const ids = { summary: useId(), description: useId() };
  const { squash } = useCommitActions(repo);
  const markers = useHistoryMarkers(repo);
  const showInfo = useNotify((s) => s.showInfo);
  const oldestFirst = [...commits].reverse();
  const [summary, setSummary] = useState(oldestFirst[0].summary);
  const [description, setDescription] = useState(
    oldestFirst
      .slice(1)
      .map((c) => `- ${c.summary}`)
      .join("\n"),
  );
  const unpushed = new Set(markers.data?.unpushed ?? []);
  const hasRemote = markers.data?.refs.some((r) => r.kind === "remote") ?? false;
  const pushed = hasRemote && commits.some((c) => !unpushed.has(c.oid));
  const count = commits.length;
  const { busy, error, submit } = useSubmit(
    () =>
      squash.mutateAsync({
        oids: commits.map((c) => c.oid),
        message: description.trim() ? `${summary.trim()}\n\n${description.trim()}` : summary,
      }),
    () => {
      showInfo(t("done.squashed", { count }));
      onClose();
    },
  );

  return (
    <FormDialog
      open
      onOpenChange={(open) => !open && !busy && onClose()}
      title={t("squash.title", { count })}
      onSubmit={() => summary.trim() && submit()}
      dismissible={!busy}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            {t("squash.cancel")}
          </Button>
          <Button
            type="submit"
            variant={pushed ? "danger" : "primary"}
            disabled={busy || !summary.trim()}
          >
            {t("squash.submit")}
          </Button>
        </>
      }
    >
      <p>{t("squash.body")}</p>
      <Field
        label={t("squash.summary")}
        value={summary}
        onChange={(e) => setSummary(e.target.value)}
        autoFocus
      />
      <div className={fieldStyles.field}>
        <label htmlFor={ids.description} className={fieldStyles.label}>
          {t("squash.description")}
        </label>
        <textarea
          id={ids.description}
          className={`${fieldStyles.input} ${styles.squashDescription}`}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={5}
        />
      </div>
      {pushed && <p>{t("squash.pushed")}</p>}
      <p className={styles.dialogNote}>{t("squash.recover")}</p>
      {error && <ErrorMessage error={error} />}
    </FormDialog>
  );
}

/** Picks a local branch to switch to and apply the commits on. */
function CherryPickOntoDialog({
  repo,
  commits,
  onClose,
}: {
  repo: string;
  /** Newest first. */
  commits: CommitSummary[];
  onClose: () => void;
}) {
  const { t } = useTranslation("history");
  const id = useId();
  const status = useStatus(repo);
  const branches = useBranches(repo);
  const { cherryPickOnto } = useCommitActions(repo);
  const showInfo = useNotify((s) => s.showInfo);
  const current = status.data?.branch.head ?? null;
  const options: SelectOption<string>[] = (branches.data ?? [])
    .filter((b) => b.kind === "local" && b.name !== current)
    .map((b) => ({ value: b.name, label: b.name }));
  const [choice, setChoice] = useState<string | null>(null);
  const branch = choice ?? options[0]?.value ?? null;
  const count = commits.length;
  const { busy, error, submit } = useSubmit(async () => {
    const oids = commits.map((c) => c.oid).reverse();
    const { picked, skipped } = await cherryPickOnto.mutateAsync({ branch: branch!, oids });
    showInfo(
      [
        t("done.cherryPickedOnto", { count: picked, branch: branch! }),
        skipped > 0 ? t("done.skipped", { count: skipped }) : "",
      ].join(" "),
    );
  }, onClose);

  return (
    <FormDialog
      open
      onOpenChange={(open) => !open && !busy && onClose()}
      title={t("cherryPickOnto.title", { count })}
      onSubmit={() => branch && submit()}
      dismissible={!busy}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            {t("cherryPickOnto.cancel")}
          </Button>
          <Button type="submit" variant="primary" disabled={busy || !branch}>
            {t("cherryPickOnto.submit")}
          </Button>
        </>
      }
    >
      <p>{t("cherryPickOnto.body")}</p>
      {branches.data && !branch ? (
        <p>{t("cherryPickOnto.none")}</p>
      ) : (
        branch && (
          <div className={styles.filterRow}>
            <label className={styles.filterLabel} htmlFor={id}>
              {t("cherryPickOnto.branch")}
            </label>
            <Select id={id} value={branch} options={options} onChange={setChoice} />
          </div>
        )
      )}
      {error && <ErrorMessage error={error} />}
    </FormDialog>
  );
}

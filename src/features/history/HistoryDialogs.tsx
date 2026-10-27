import { useId, useState } from "react";
import { useTranslation } from "react-i18next";

import { ErrorMessage } from "../../components/ErrorMessage";
import { Button } from "../../components/ui/Button";
import { Checkbox } from "../../components/ui/Checkbox";
import { FormDialog } from "../../components/ui/Dialog";
import { Field } from "../../components/ui/Field";
import fieldStyles from "../../components/ui/Field.module.css";
import { Loading } from "../../components/ui/Loading";
import { Select, type SelectOption } from "../../components/ui/Select";
import {
  commands,
  unwrap,
  toAppError,
  type AppError,
  type CommitSummary,
  type CompareMode,
  type ResetMode,
} from "../../ipc";
import { shortHash } from "../../lib/hash";
import { useRelativeTime } from "../../lib/time";
import { refName, useBranches } from "../branches/api";
import branchStyles from "../branches/branches.module.css";
import { useBranchDialog } from "../branches/branchDialogStore";
import { useStatus } from "../changes/api";
import { useNotify } from "../notify/notifyStore";
import { useRemoteInfo } from "../sync/api";
import { useTagPush } from "../tags/api";
import { useCommitActions, useHistoryMarkers, useLostCommits } from "./api";
import { CommitTitle } from "./CommitTitle";
import { CompareModeSwitch } from "./CompareView";
import styles from "./History.module.css";
import { useHistoryDialog, type SquashOnto } from "./historyDialogStore";
import { useHistoryPane } from "./historyPaneStore";
import { FixupDialog } from "./FixupDialog";
import { useSquashUndoDialog } from "./squashUndoStore";
import { RewordDialog } from "./RewordDialog";

/** Renders whichever history dialog is open for `repo`. */
export function HistoryDialogs({
  repo,
  onReword,
}: {
  repo: string;
  onReword: (oid: string) => void;
}) {
  const { dialog, close } = useHistoryDialog();
  if (!dialog) return null;
  switch (dialog.kind) {
    case "reword":
      return (
        <RewordDialog
          key={dialog.commit.oid}
          repo={repo}
          commit={dialog.commit}
          head={dialog.head}
          branch={dialog.branch}
          onClose={close}
          onReword={onReword}
        />
      );
    case "fixup":
      return (
        <FixupDialog
          key={dialog.commit.oid}
          repo={repo}
          commit={dialog.commit}
          head={dialog.head}
          branch={dialog.branch}
          onClose={close}
          onFixup={onReword}
        />
      );
    case "reset":
      return <ResetDialog repo={repo} commit={dialog.commit} onClose={close} />;
    case "checkout":
      return <CheckoutDialog repo={repo} commit={dialog.commit} onClose={close} />;
    case "tag":
      return <TagDialog repo={repo} commit={dialog.commit} onClose={close} />;
    case "deleteTag":
      return (
        <DeleteTagDialog repo={repo} commit={dialog.commit} tag={dialog.tag} onClose={close} />
      );
    case "overwriteTag":
      return (
        <OverwriteTagDialog repo={repo} tag={dialog.tag} remote={dialog.remote} onClose={close} />
      );
    case "cherryPickOnto":
      return <CherryPickOntoDialog repo={repo} commits={dialog.commits} onClose={close} />;
    case "reorder":
      return <ReorderDialog repo={repo} order={dialog.commits} onClose={close} />;
    case "squash":
      return (
        <SquashDialog repo={repo} commits={dialog.commits} onto={dialog.onto} onClose={close} />
      );
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

/**
 * Confirms deleting a tag. A tag that may be on the remote can go from
 * there too; left there, the next fetch brings it back.
 */
function DeleteTagDialog({ repo, commit, tag, onClose }: DialogProps & { tag: string }) {
  const { t } = useTranslation("history");
  const id = useId();
  const status = useStatus(repo);
  const remote = useRemoteInfo(repo).data?.defaultRemote ?? null;
  const { deleteTag } = useCommitActions(repo);
  const showInfo = useNotify((s) => s.showInfo);
  const [alsoRemote, setAlsoRemote] = useState(false);
  // Tags made here and never pushed exist only on this computer.
  const unpushed = status.data?.unpushedTags.includes(tag) ?? false;
  const offerRemote = remote !== null && !unpushed;
  const fromRemote = offerRemote && alsoRemote ? remote : null;
  const { busy, error, submit } = useSubmit(
    () => deleteTag.mutateAsync({ name: tag, remote: fromRemote }),
    () => {
      showInfo(
        fromRemote
          ? t("done.tagDeletedEverywhere", { name: tag, remote: fromRemote })
          : t("done.tagDeleted", { name: tag }),
      );
      onClose();
    },
  );

  return (
    <FormDialog
      open
      onOpenChange={(open) => !open && !busy && onClose()}
      title={t("deleteTag.title", { name: tag })}
      onSubmit={submit}
      dismissible={!busy}
      footer={
        <>
          <Button onClick={onClose} disabled={busy} autoFocus>
            {t("deleteTag.cancel")}
          </Button>
          <Button type="submit" variant="danger" disabled={busy}>
            {t("deleteTag.submit")}
          </Button>
        </>
      }
    >
      <p>
        {t(unpushed ? "deleteTag.bodyUnpushed" : "deleteTag.body", {
          summary: commit.summary,
          hash: shortHash(commit.oid),
        })}
      </p>
      {offerRemote && (
        <label className={branchStyles.option} htmlFor={id}>
          <Checkbox
            id={id}
            state={alsoRemote ? "checked" : "unchecked"}
            disabled={busy}
            onChange={(e) => setAlsoRemote(e.target.checked)}
          />
          <span>
            <span className={branchStyles.optionLabel}>
              {t("deleteTag.alsoRemote", { remote })}
            </span>
            <span className={branchStyles.optionHint}>
              {t("deleteTag.alsoRemoteHint", { remote })}
            </span>
          </span>
        </label>
      )}
      {error && <ErrorMessage error={error} />}
    </FormDialog>
  );
}

/**
 * Replaces the remote's tag of the same name. Anyone who fetched the old
 * one keeps it, so this asks first.
 */
function OverwriteTagDialog({
  repo,
  tag,
  remote,
  onClose,
}: {
  repo: string;
  tag: string;
  remote: string;
  onClose: () => void;
}) {
  const { t } = useTranslation("history");
  const push = useTagPush(repo);
  const showInfo = useNotify((s) => s.showInfo);
  const { busy, error, submit } = useSubmit(
    () => push.mutateAsync({ remote, names: [tag], force: true }),
    () => {
      showInfo(t("done.tagPushed", { name: tag, remote }));
      onClose();
    },
  );
  return (
    <FormDialog
      open
      onOpenChange={(open) => !open && !busy && onClose()}
      title={t("overwriteTag.title", { name: tag, remote })}
      onSubmit={submit}
      dismissible={!busy}
      footer={
        <>
          <Button onClick={onClose} disabled={busy} autoFocus>
            {t("overwriteTag.cancel")}
          </Button>
          <Button type="submit" variant="danger" disabled={busy}>
            {t("overwriteTag.submit")}
          </Button>
        </>
      }
    >
      <p>{t("overwriteTag.body", { name: tag, remote })}</p>
      {error && <ErrorMessage error={error} />}
    </FormDialog>
  );
}

/** Picks a branch to compare with the current one, three-dot. */
/** Picks two branches to compare, and how. */
function CompareBranchDialog({ repo, onClose }: { repo: string; onClose: () => void }) {
  const { t } = useTranslation("history");
  const ids = { base: useId(), target: useId() };
  const status = useStatus(repo);
  const branches = useBranches(repo);
  const showPane = useHistoryPane((s) => s.show);
  const current = status.data?.branch.head ?? null;
  const head = status.data?.branch.oid ?? null;

  // A detached HEAD can be compared too, under its own name.
  const options: SelectOption<string>[] = [
    ...(current === null && head ? [{ value: head, label: t("compareBranch.detached") }] : []),
    ...(branches.data ?? []).map((b) => ({ value: refName(b), label: b.name })),
  ];
  const fallbackBase = current ? `refs/heads/${current}` : (head ?? options[0]?.value ?? null);
  const [base, setBase] = useState<string | null>(null);
  const [target, setTarget] = useState<string | null>(null);
  const [mode, setMode] = useState<CompareMode>("three_dot");
  const baseValue = base ?? fallbackBase;
  const targetValue = target ?? options.find((o) => o.value !== baseValue)?.value ?? null;
  const label = (value: string) => options.find((o) => o.value === value)?.label ?? value;
  const same = baseValue !== null && baseValue === targetValue;
  const ready = baseValue !== null && targetValue !== null && !same;

  const submit = () => {
    if (!ready) return;
    showPane(repo, {
      kind: "compare",
      base: baseValue,
      target: targetValue,
      mode,
      baseLabel: label(baseValue),
      targetLabel: label(targetValue),
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
          <Button type="submit" variant="primary" disabled={!ready}>
            {t("compareBranch.submit")}
          </Button>
        </>
      }
    >
      {baseValue && targetValue && (
        <>
          <div className={styles.filterRow}>
            <label className={styles.filterLabel} htmlFor={ids.base}>
              {t("compareBranch.base")}
            </label>
            <Select id={ids.base} value={baseValue} options={options} onChange={setBase} />
          </div>
          <div className={styles.filterRow}>
            <label className={styles.filterLabel} htmlFor={ids.target}>
              {t("compareBranch.target")}
            </label>
            <Select id={ids.target} value={targetValue} options={options} onChange={setTarget} />
          </div>
          <CompareModeSwitch value={mode} onChange={setMode} />
          <p className={styles.dialogNote}>
            {t(mode === "three_dot" ? "compareBranch.threeDotHint" : "compareBranch.twoDotHint", {
              base: label(baseValue),
              target: label(targetValue),
            })}
          </p>
          {same && <p>{t("compareBranch.same")}</p>}
        </>
      )}
    </FormDialog>
  );
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
                {shortHash(entry.oid)} · {relativeTime(entry.visitedAt)} ·{" "}
                {entry.action === "garam_squash_backup" ? t("recover.squashBackup") : entry.action}
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
  onto,
  onClose,
}: {
  repo: string;
  /** Newest first. */
  commits: CommitSummary[];
  onto?: SquashOnto;
  onClose: () => void;
}) {
  const { t } = useTranslation("history");
  const ids = { summary: useId(), description: useId() };
  const { squash, squashOnto } = useCommitActions(repo);
  const markers = useHistoryMarkers(repo);
  const showInfo = useNotify((s) => s.showInfo);
  const oldestFirst = [...commits].reverse();
  const initial = onto?.target ?? oldestFirst[0];
  const [summary, setSummary] = useState(initial.summary);
  const [description, setDescription] = useState(
    oldestFirst
      .filter((c) => c.oid !== initial.oid)
      .map((c) => `- ${c.summary}`)
      .join("\n"),
  );
  const unpushed = new Set(markers.data?.unpushed ?? []);
  const hasRemote = markers.data?.refs.some((r) => r.kind === "remote") ?? false;
  const pushed = hasRemote && (onto?.rewritten ?? commits).some((c) => !unpushed.has(c.oid));
  const count = commits.length;
  const { busy, error, submit } = useSubmit(
    async () => {
      const message = description.trim() ? `${summary.trim()}\n\n${description.trim()}` : summary;
      if (onto) {
        await squashOnto.mutateAsync({
          oids: commits.filter((c) => c.oid !== onto.target.oid).map((c) => c.oid),
          target: onto.target.oid,
          head: onto.head,
          branch: onto.branch,
          message,
        });
      } else
        await squash.mutateAsync({
          oids: commits.map((c) => c.oid),
          message,
        });
    },
    () => {
      onClose();
      void unwrap(commands.squashUndoGet(repo))
        .then((info) => {
          showInfo(
            t("done.squashed", { count }),
            info
              ? {
                  label: t("undoSquash.notice", { count }),
                  run: () => useSquashUndoDialog.getState().open(repo, info),
                }
              : undefined,
          );
        })
        .catch(() => showInfo(t("done.squashed", { count })));
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
      <p>{onto ? t("squash.ontoBody", { summary: onto.target.summary }) : t("squash.body")}</p>
      {onto && (
        <ul className={styles.compareCommits}>
          {[onto.target, ...oldestFirst.filter((c) => c.oid !== onto.target.oid)].map((c) => (
            <li key={c.oid}>
              <code>{shortHash(c.oid)}</code> {c.summary}
            </li>
          ))}
        </ul>
      )}
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

/** Confirms reordering commits that were already pushed. */
function ReorderDialog({
  repo,
  order,
  onClose,
}: {
  repo: string;
  /** Newest first, in the new order. */
  order: CommitSummary[];
  onClose: () => void;
}) {
  const { t } = useTranslation("history");
  const { reorder } = useCommitActions(repo);
  const showInfo = useNotify((s) => s.showInfo);
  const { busy, error, submit } = useSubmit(
    () => reorder.mutateAsync(order.map((c) => c.oid)),
    () => {
      showInfo(t("done.reordered"));
      onClose();
    },
  );
  return (
    <FormDialog
      open
      onOpenChange={(open) => !open && !busy && onClose()}
      title={t("reorder.title")}
      onSubmit={submit}
      dismissible={!busy}
      footer={
        <>
          <Button onClick={onClose} disabled={busy} autoFocus>
            {t("reorder.cancel")}
          </Button>
          <Button type="submit" variant="danger" disabled={busy}>
            {t("reorder.submit")}
          </Button>
        </>
      }
    >
      <p>{t("reorder.body")}</p>
      <ol className={styles.compareCommits}>
        {order.map((commit) => (
          <li key={commit.oid}>
            <span className={styles.compareHash}>{shortHash(commit.oid)}</span>{" "}
            <CommitTitle summary={commit.summary} />
          </li>
        ))}
      </ol>
      <p className={styles.dialogNote}>{t("reorder.recover")}</p>
      {error && <ErrorMessage error={error} />}
    </FormDialog>
  );
}

import { useEffect, useId, useState, type KeyboardEvent } from "react";
import { Trans, useTranslation } from "react-i18next";

import { ErrorMessage } from "../../components/ErrorMessage";
import { Button } from "../../components/ui/Button";
import { Checkbox } from "../../components/ui/Checkbox";
import { Tooltip } from "../../components/ui/Tooltip";
import { toAppError, type AppError, type BranchStatus, type Identity } from "../../ipc";
import { currentPlatform } from "../../lib/platform";
import { useRepoAccount } from "../accounts/api";
import { emailBelongsTo } from "../accounts/repoAccount";
import { useChangeActions, useHeadCommit, useIdentity } from "./api";
import { useCommitDrafts } from "./commitDraftStore";
import styles from "./CommitForm.module.css";
import { parseCoAuthors } from "./fileState";
import { IdentityDialog } from "./IdentityDialog";
import { formatIdentity, RepoIdentityDialog } from "./RepoIdentityDialog";

const LONG_SUMMARY = 72;

export function CommitForm({
  repo,
  branch,
  stagedCount,
}: {
  repo: string;
  branch: BranchStatus;
  stagedCount: number;
}) {
  const { t } = useTranslation("changes");
  const ids = { summary: useId(), description: useId(), coAuthors: useId(), amend: useId() };
  const { commit } = useChangeActions(repo);
  const identity = useIdentity(repo);
  const repoAccount = useRepoAccount(repo, identity.data?.effective.email ?? null);
  // A waiting draft (from an undone commit) fills the form once.
  const draft = useCommitDrafts((s) => s.drafts[repo]);
  const clearDraft = useCommitDrafts((s) => s.clear);
  const [summary, setSummary] = useState(draft?.summary ?? "");
  const [description, setDescription] = useState(draft?.description ?? "");
  useEffect(() => {
    if (draft) clearDraft(repo);
  }, [draft, clearDraft, repo]);
  const [coAuthorsText, setCoAuthorsText] = useState("");
  const [showCoAuthors, setShowCoAuthors] = useState(false);
  const [amend, setAmend] = useState(false);
  const [prefill, setPrefill] = useState<{ summary: string; description: string } | null>(null);
  const [error, setError] = useState<AppError>();
  const [askIdentity, setAskIdentity] = useState(false);
  const [editRepoIdentity, setEditRepoIdentity] = useState(false);
  const head = useHeadCommit(repo, amend);
  const canAmend = branch.oid !== null;

  const coAuthors = parseCoAuthors(showCoAuthors ? coAuthorsText : "");
  const ready =
    summary.trim() !== "" && coAuthors.ok && (stagedCount > 0 || amend) && !commit.isPending;

  const toggleAmend = (next: boolean) => {
    setAmend(next);
    applyAmend(next);
  };

  // Fill the form with the last commit's message when amending, and clear
  // it again when amending is turned off without edits.
  const applyAmend = (next: boolean) => {
    if (next && head.data && !summary && !description) {
      setSummary(head.data.summary);
      setDescription(head.data.body);
      setPrefill({ summary: head.data.summary, description: head.data.body });
    } else if (
      !next &&
      prefill &&
      summary === prefill.summary &&
      description === prefill.description
    ) {
      setSummary("");
      setDescription("");
      setPrefill(null);
    }
  };

  // The head commit may arrive after the box was ticked.
  if (amend && head.data && prefill === null && !summary && !description) {
    applyAmend(true);
  }

  // `identityConfirmed` skips the check right after the identity dialog
  // saved, before the identity query has refetched.
  const submit = (identityConfirmed = false) => {
    if (!ready || !coAuthors.ok) return;
    if (!identityConfirmed && identity.data && !isComplete(identity.data.effective)) {
      setAskIdentity(true);
      return;
    }
    setError(undefined);
    commit.mutate(
      { summary, description, coAuthors: coAuthors.coAuthors, amend },
      {
        onSuccess: () => {
          setSummary("");
          setDescription("");
          setCoAuthorsText("");
          setShowCoAuthors(false);
          setAmend(false);
          setPrefill(null);
        },
        onError: (e) => {
          const appError = toAppError(e);
          if (appError.kind === "identity_missing") setAskIdentity(true);
          else setError(appError);
        },
      },
    );
  };

  const onKeyDown = (e: KeyboardEvent) => {
    // Ignore Enter while an IME (e.g. Korean) is still composing a syllable.
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  // Only the branch name shrinks (with an ellipsis), so "Commit to" stays.
  const label = amend ? (
    t("commit.submitAmend")
  ) : branch.head ? (
    <Trans
      t={t}
      i18nKey="commit.submit"
      values={{ branch: branch.head }}
      components={{ branch: <span className={styles.branch} /> }}
    />
  ) : (
    t("commit.submitDetached")
  );
  const shortcut = t("commit.shortcut", { key: currentPlatform() === "macos" ? "⌘" : "Ctrl" });

  return (
    <form
      className={styles.form}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <label htmlFor={ids.summary} className={styles.srOnly}>
        {t("commit.summary")}
      </label>
      <input
        id={ids.summary}
        className={styles.summary}
        placeholder={t("commit.summaryPlaceholder")}
        value={summary}
        onChange={(e) => setSummary(e.target.value)}
        onKeyDown={onKeyDown}
        aria-describedby={summary.length > LONG_SUMMARY ? `${ids.summary}-long` : undefined}
      />
      {summary.length > LONG_SUMMARY && (
        <p id={`${ids.summary}-long`} className={styles.hint}>
          {t("commit.summaryLong")}
        </p>
      )}
      <label htmlFor={ids.description} className={styles.srOnly}>
        {t("commit.description")}
      </label>
      <textarea
        id={ids.description}
        className={styles.description}
        placeholder={t("commit.descriptionPlaceholder")}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        onKeyDown={onKeyDown}
        rows={4}
      />

      {showCoAuthors && (
        <>
          <label htmlFor={ids.coAuthors} className={styles.fieldLabel}>
            {t("commit.coAuthors")}
          </label>
          <textarea
            id={ids.coAuthors}
            className={styles.description}
            placeholder={t("commit.coAuthorsPlaceholder")}
            value={coAuthorsText}
            onChange={(e) => setCoAuthorsText(e.target.value)}
            onKeyDown={onKeyDown}
            rows={2}
            aria-invalid={!coAuthors.ok}
          />
          {!coAuthors.ok && <p className={styles.hint}>{t("commit.coAuthorsInvalid")}</p>}
        </>
      )}

      <div className={styles.options}>
        <label className={styles.option} htmlFor={ids.amend}>
          <Checkbox
            id={ids.amend}
            state={amend ? "checked" : "unchecked"}
            disabled={!canAmend}
            onChange={(e) => toggleAmend(e.target.checked)}
          />
          {t("commit.amend")}
        </label>
        <button
          type="button"
          className={styles.link}
          aria-expanded={showCoAuthors}
          onClick={() => setShowCoAuthors((v) => !v)}
        >
          {t("commit.coAuthors")}
        </button>
      </div>

      {identity.data && (
        <AuthorLine
          author={formatIdentity(identity.data.effective)}
          overridden={identity.data.local.name !== null || identity.data.local.email !== null}
          login={repoAccount.account?.login ?? null}
          mismatch={
            repoAccount.account !== null &&
            identity.data.effective.email !== null &&
            !emailBelongsTo(repoAccount.account, identity.data.effective.email)
          }
          onEdit={() => setEditRepoIdentity(true)}
        />
      )}

      {error && <ErrorMessage error={error} />}
      <Tooltip
        content={
          <>
            {label}
            <br />
            {shortcut}
          </>
        }
        side="top"
      >
        <Button type="submit" variant="primary" className={styles.submit} disabled={!ready}>
          <span className={styles.label}>{label}</span>
        </Button>
      </Tooltip>

      {askIdentity && (
        <IdentityDialog
          repo={repo}
          current={identity.data?.effective}
          onClose={() => setAskIdentity(false)}
          onSaved={() => {
            setAskIdentity(false);
            submit(true);
          }}
        />
      )}
      {editRepoIdentity && identity.data && (
        <RepoIdentityDialog
          repo={repo}
          identity={identity.data}
          repoAccount={repoAccount}
          onClose={() => setEditRepoIdentity(false)}
        />
      )}
    </form>
  );
}

const isComplete = (identity: Identity) => Boolean(identity.name && identity.email);

/**
 * Who the commit will be recorded as and which GitHub account pushes it;
 * opens the per-repository choice.
 */
function AuthorLine({
  author,
  overridden,
  login,
  mismatch,
  onEdit,
}: {
  author: string | null;
  overridden: boolean;
  login: string | null;
  /** The author email isn't one of the account's, so GitHub won't link it. */
  mismatch: boolean;
  onEdit: () => void;
}) {
  const { t } = useTranslation("changes");
  return (
    <>
      <Tooltip content={t("commit.authorEdit")} side="top">
        <button type="button" className={styles.author} onClick={onEdit}>
          <span className={styles.authorLabel}>{t("commit.author")}</span>
          <span className={styles.authorValue}>{author ?? t("commit.authorMissing")}</span>
          {overridden && <span className={styles.authorScope}>{t("commit.authorRepo")}</span>}
          {login && <span className={styles.authorAccount}>@{login}</span>}
        </button>
      </Tooltip>
      {mismatch && login && (
        <p className={styles.mismatch} role="status">
          {t("commit.authorMismatch", { login })}
        </p>
      )}
    </>
  );
}

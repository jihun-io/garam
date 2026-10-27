import { useEffect, useId, useState, type KeyboardEvent } from "react";
import { Trans, useTranslation } from "react-i18next";

import { ErrorMessage } from "../../components/ErrorMessage";
import { Button } from "../../components/ui/Button";
import { Tooltip } from "../../components/ui/Tooltip";
import {
  commands,
  toAppError,
  type AppError,
  type BranchStatus,
  type Finding,
  type Identity,
} from "../../ipc";
import { currentPlatform } from "../../lib/platform";
import { useRepoAccount } from "../accounts/api";
import { emailBelongsTo } from "../accounts/repoAccount";
import { useSettings } from "../settings/api";
import { useChangeActions, useIdentity } from "./api";
import { useBeginAmend } from "./amendApi";
import { CommitCheckDialog } from "./CommitCheckDialog";
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
  const ids = { summary: useId(), description: useId(), coAuthors: useId() };
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
  const [coAuthorsText, setCoAuthorsText] = useState(draft?.coAuthorsText ?? "");
  const [showCoAuthors, setShowCoAuthors] = useState(draft?.showCoAuthors ?? false);
  const setDraft = useCommitDrafts((s) => s.set);
  const beginAmend = useBeginAmend(repo, () =>
    setDraft(repo, { summary, description, coAuthorsText, showCoAuthors }),
  );
  const [error, setError] = useState<AppError>();
  const [askIdentity, setAskIdentity] = useState(false);
  const [editRepoIdentity, setEditRepoIdentity] = useState(false);
  const { commitChecks } = useSettings();
  const [checking, setChecking] = useState(false);
  const [findings, setFindings] = useState<Finding[] | null>(null);
  const canAmend = branch.oid !== null;

  const coAuthors = parseCoAuthors(showCoAuthors ? coAuthorsText : "");
  const ready =
    summary.trim() !== "" &&
    coAuthors.ok &&
    stagedCount > 0 &&
    !commit.isPending &&
    !beginAmend.isPending &&
    !checking;

  // `identityConfirmed` skips the check right after the identity dialog
  // saved, before the identity query has refetched.
  const submit = (identityConfirmed = false) => {
    if (!ready || !coAuthors.ok) return;
    if (!identityConfirmed && identity.data && !isComplete(identity.data.effective)) {
      setAskIdentity(true);
      return;
    }
    setError(undefined);
    if (!commitChecks) {
      createCommit();
      return;
    }
    setChecking(true);
    // A check that fails to run shouldn't stand between the user and their
    // commit.
    void commands
      .commitCheck(repo)
      .then((result) => {
        if (result.status === "ok" && result.data.length > 0) setFindings(result.data);
        else createCommit();
      }, createCommit)
      .finally(() => setChecking(false));
  };

  const createCommit = () => {
    if (!coAuthors.ok) return;
    commit.mutate(
      { summary, description, coAuthors: coAuthors.coAuthors, amend: false },
      {
        onSuccess: () => {
          setSummary("");
          setDescription("");
          setCoAuthorsText("");
          setShowCoAuthors(false);
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
  const label = branch.head ? (
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
        <button
          type="button"
          className={styles.link}
          disabled={!canAmend || beginAmend.isPending}
          onClick={() => {
            if (!branch.oid) return;
            beginAmend.mutate(branch.oid);
          }}
        >
          {t("commit.amend")}
        </button>
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
        <Button
          type="submit"
          variant="primary"
          icon="commit"
          className={styles.submit}
          disabled={!ready}
        >
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
      {findings && (
        <CommitCheckDialog
          repo={repo}
          findings={findings}
          canCommit={stagedCount > 0}
          onCommit={() => {
            setFindings(null);
            createCommit();
          }}
          onClose={() => setFindings(null)}
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

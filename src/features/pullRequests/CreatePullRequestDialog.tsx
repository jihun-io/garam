import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";

import { ErrorMessage } from "../../components/ErrorMessage";
import { Button } from "../../components/ui/Button";
import { Checkbox } from "../../components/ui/Checkbox";
import { FormDialog } from "../../components/ui/Dialog";
import { Field } from "../../components/ui/Field";
import { Loading } from "../../components/ui/Loading";
import { Select } from "../../components/ui/Select";
import {
  toAppError,
  type AppError,
  type Branch,
  type PullRequestTargets,
  type RepoId,
} from "../../ipc";
import { runCommand } from "../../lib/commands";
import { shortHash } from "../../lib/hash";
import { useAccounts, useRepoAccount } from "../accounts/api";
import { useBranches } from "../branches/api";
import { useIdentity } from "../changes/api";
import { RepoIdentityDialog } from "../changes/RepoIdentityDialog";
import { useCommitDetail, useComparison } from "../history/api";
import { ChangedFiles } from "../history/CommitDetailView";
import { CommitTitle } from "../history/CommitTitle";
import { useNotify } from "../notify/notifyStore";
import { useRemoteInfo, useSyncActions } from "../sync/api";
import {
  branchPullRequest,
  readyContext,
  useCreatePullRequest,
  usePullRequestContext,
  usePullRequests,
  usePullRequestTemplate,
} from "./api";
import { headRef, sameRepo, suggestText } from "./fill";
import styles from "./PullRequests.module.css";

/** Commits listed above the preview before "and N more". */
const SHOWN_COMMITS = 5;

/**
 * Opens a pull request for a local branch: where it goes, title and body,
 * draft or not, with what it would contain beside the form.
 */
export function CreatePullRequestDialog({
  repo,
  branch,
  onClose,
}: {
  repo: string;
  branch: string;
  onClose: () => void;
}) {
  const { t } = useTranslation("pullRequests");
  const context = usePullRequestContext(repo);
  const local = useBranches(repo).data?.find((b) => b.kind === "local" && b.name === branch);
  const ready = readyContext(context.data);

  if (ready && local) {
    return <CreateForm repo={repo} branch={local} context={ready} onClose={onClose} />;
  }
  const blocked = context.data?.status === "blocked" ? context.data.error : null;
  if (context.data && !blocked && !context.isError && local) {
    return (
      <NoAccess repo={repo} unsupported={context.data.status === "unsupported"} onClose={onClose} />
    );
  }
  return (
    <FormDialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={t("dialog.title")}
      onSubmit={onClose}
      footer={
        <>
          {(blocked || context.isError) && (
            <Button
              type="button"
              disabled={context.isFetching}
              aria-busy={context.isFetching}
              onClick={() => void context.refetch()}
            >
              {t("dialog.checkAgain")}
            </Button>
          )}
          <Button type="submit" variant="primary">
            {t("dialog.close")}
          </Button>
        </>
      }
    >
      {blocked ? (
        <AccessError error={blocked} />
      ) : context.isError ? (
        <AccessError error={toAppError(context.error)} />
      ) : (
        <Loading />
      )}
    </FormDialog>
  );
}

/** Errors about access come with a way to fix them on GitHub. */
function AccessError({ error }: { error: AppError }) {
  const { t } = useTranslation("pullRequests");
  const showError = useNotify((s) => s.showError);
  const settingsUrl = useAccounts().data?.authorizationSettingsUrl;
  const open = (url: string) => void openUrl(url).catch(showError);
  return (
    <div className={styles.errorBlock}>
      <ErrorMessage error={error} />
      {error.kind === "github_sso_required" && error.params.url && (
        <Button onClick={() => open(error.params.url)}>{t("dialog.authorizeSso")}</Button>
      )}
      {/* GitHub hides a repository an organization blocks Garam from, so
          "not found" may be the same block. */}
      {(error.kind === "github_oauth_app_restricted" || error.kind === "github_not_found") &&
        settingsUrl && (
          <Button onClick={() => open(settingsUrl)}>{t("dialog.requestAccess")}</Button>
        )}
    </div>
  );
}

/** Without an account the dialog asks for one first. */
function NoAccess({
  repo,
  unsupported,
  onClose,
}: {
  repo: string;
  unsupported: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation("pullRequests");
  const identity = useIdentity(repo);
  const repoAccount = useRepoAccount(repo, identity.data?.effective.email ?? null);
  const [choosing, setChoosing] = useState(false);
  if (choosing && identity.data) {
    // The context refetches once the account is saved; the dialog follows.
    return (
      <RepoIdentityDialog
        repo={repo}
        identity={identity.data}
        repoAccount={repoAccount}
        onClose={() => setChoosing(false)}
      />
    );
  }
  const signedIn = repoAccount.accounts.length > 0;
  return (
    <FormDialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={t("dialog.title")}
      onSubmit={() => {
        if (unsupported) onClose();
        else if (signedIn) setChoosing(true);
        else {
          onClose();
          runCommand("settings");
        }
      }}
      footer={
        <>
          {!unsupported && (
            <Button type="button" onClick={onClose}>
              {t("dialog.cancel")}
            </Button>
          )}
          <Button type="submit" variant="primary">
            {unsupported
              ? t("dialog.close")
              : signedIn
                ? t("dialog.chooseAccount")
                : t("dialog.signIn")}
          </Button>
        </>
      }
    >
      <p>
        {unsupported
          ? t("dialog.unsupported")
          : signedIn
            ? t("dialog.noAccount")
            : t("dialog.notSignedIn")}
      </p>
    </FormDialog>
  );
}

function CreateForm({
  repo,
  branch,
  context,
  onClose,
}: {
  repo: string;
  branch: Branch;
  context: PullRequestTargets;
  onClose: () => void;
}) {
  const { t } = useTranslation("pullRequests");
  const ids = { target: useId(), base: useId(), body: useId() };
  const { showInfo, showError } = useNotify();
  const remote = useRemoteInfo(repo).data?.defaultRemote ?? null;
  const branches = useBranches(repo).data ?? [];
  const sync = useSyncActions(repo);
  const create = useCreatePullRequest(repo);
  const existing = branchPullRequest(
    usePullRequests(repo, branch.isHead ? branch.name : null).data,
    branch.name,
    branch.oid,
  );

  const [targetIndex, setTargetIndex] = useState(0);
  const target = context.targets[targetIndex] ?? context.targets[0];
  const [base, setBase] = useState(target.repo.defaultBranch ?? "");
  // What the user typed; `null` keeps following the suggestion.
  const [typedTitle, setTitle] = useState<string | null>(null);
  const [typedBody, setBody] = useState<string | null>(null);
  const [draft, setDraft] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AppError>();
  const [syncBusy, setSyncBusy] = useState(false);

  // Bring the base up to date once, without asking for a sign-in.
  useEffect(() => {
    if (target.remote) {
      void sync.run({ action: "fetch", remote: target.remote, background: true }).catch(() => {});
    }
    // Only for the target picked when the dialog opens, or a new one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target.remote]);

  const baseRef = target.remote && base ? `refs/remotes/${target.remote}/${base}` : null;
  const comparison = useComparison(
    repo,
    baseRef ?? "",
    `refs/heads/${branch.name}`,
    "three_dot",
    baseRef !== null,
  );
  const commits = comparison.data?.commits ?? [];
  const template = usePullRequestTemplate(repo, baseRef);
  const single = useCommitDetail(repo, commits.length === 1 ? commits[0].oid : null);

  // Filled from the commits until the user types; changing the base
  // refills only what they haven't typed. Without a base to compare with,
  // the branch name is all there is.
  const loaded =
    baseRef === null ||
    (comparison.data !== undefined && template.isFetched && (commits.length !== 1 || single.data));
  const suggestion = loaded
    ? suggestText({
        branch: branch.name,
        summaries: commits.map((c) => c.summary),
        singleBody: single.data?.body ?? null,
        template: template.data ?? null,
      })
    : null;
  const title = typedTitle ?? suggestion?.title ?? "";
  const body = typedBody ?? suggestion?.body ?? "";

  // Branches of the target to merge into, from its local remote.
  const baseOptions = target.remote
    ? branches
        .filter((b) => b.kind === "remote" && b.remote === target.remote)
        .map((b) => b.name.slice(target.remote!.length + 1))
        .filter((name) => name !== "HEAD")
    : [];
  if (base && !baseOptions.includes(base)) baseOptions.unshift(base);

  const unpublished = branch.upstream === null;
  const unpushed = !unpublished && branch.ahead > 0;
  const remoteBranch = unpublished
    ? branch.name
    : remote && branch.upstream?.startsWith(`${remote}/`)
      ? branch.upstream.slice(remote.length + 1)
      : null;
  // A branch can't ask to be merged into itself: on the repository's own
  // `main`, the commits need a branch of their own first. (From a fork,
  // `main` into the parent's `main` is fine.)
  const intoItself = remoteBranch === base && sameRepo(context.head, target.repo);
  const nothingToAdd = !intoItself && comparison.data !== undefined && comparison.data.ahead === 0;
  const canSubmit =
    !busy &&
    title.trim() !== "" &&
    base !== "" &&
    remoteBranch !== null &&
    !intoItself &&
    !nothingToAdd;

  const submit = async () => {
    if (!canSubmit || remoteBranch === null) return;
    setBusy(true);
    setError(undefined);
    setSyncBusy(false);
    try {
      if (unpublished || unpushed) {
        const done = await sync.run({ action: unpublished ? "publish" : "push", remote });
        // Another fetch or push is running; try again once it's done.
        if (done === null) {
          setSyncBusy(true);
          return;
        }
      }
      const created = await create.mutateAsync({
        owner: target.repo.owner,
        name: target.repo.name,
        pullRequest: {
          title: title.trim(),
          body,
          head: headRef(context.head, target.repo, remoteBranch),
          base,
          draft,
        },
      });
      onClose();
      showInfo(t("created", { number: created.number }), {
        label: t("openInBrowser"),
        run: () => void openUrl(created.url).catch(showError),
      });
    } catch (e) {
      setError(toAppError(e));
    } finally {
      setBusy(false);
    }
  };

  const close = (open: boolean) => !open && !busy && onClose();
  if (existing?.state === "open") {
    return (
      <FormDialog
        open
        onOpenChange={close}
        title={t("dialog.title")}
        onSubmit={() => {
          onClose();
          void openUrl(existing.url).catch(showError);
        }}
        footer={
          <>
            <Button type="button" onClick={onClose}>
              {t("dialog.cancel")}
            </Button>
            <Button type="submit" variant="primary">
              {t("openInBrowser")}
            </Button>
          </>
        }
      >
        <p>{t("dialog.exists", { number: existing.number, branch: branch.name })}</p>
      </FormDialog>
    );
  }

  const submitLabel = intoItself
    ? t("dialog.create")
    : unpublished
      ? t("dialog.publishAndCreate")
      : unpushed
        ? t("dialog.pushAndCreate")
        : t("dialog.create");
  const targetLabel = (repo: RepoId | { owner: string; name: string }) =>
    `${repo.owner}/${repo.name}`;

  return (
    <FormDialog
      open
      wide
      onOpenChange={close}
      title={t("dialog.title")}
      onSubmit={() => void submit()}
      dismissible={!busy}
      footer={
        <>
          <Button type="button" onClick={onClose} disabled={busy}>
            {t("dialog.cancel")}
          </Button>
          <Button type="submit" variant="primary" disabled={!canSubmit} aria-busy={busy}>
            {submitLabel}
          </Button>
        </>
      }
    >
      <div className={styles.sheet}>
        <div className={styles.form}>
          <p className={styles.route}>
            {t("dialog.route", {
              branch: branch.name,
              target: targetLabel(target.repo),
            })}
          </p>
          {context.targets.length > 1 && (
            <div className={styles.field}>
              <label htmlFor={ids.target} className={styles.label}>
                {t("dialog.target")}
              </label>
              <Select
                id={ids.target}
                value={String(targetIndex)}
                onChange={(value) => {
                  const next = context.targets[Number(value)];
                  setTargetIndex(Number(value));
                  setBase(next.repo.defaultBranch ?? "");
                }}
                options={context.targets.map((target, i) => ({
                  value: String(i),
                  label: sameRepo(target.repo, context.head)
                    ? t("dialog.ownRepo", { repo: targetLabel(target.repo) })
                    : t("dialog.parentRepo", { repo: targetLabel(target.repo) }),
                }))}
              />
            </div>
          )}
          <div className={styles.field}>
            <label htmlFor={ids.base} className={styles.label}>
              {t("dialog.base")}
            </label>
            {baseOptions.length > 0 ? (
              <Select
                id={ids.base}
                value={base}
                onChange={setBase}
                options={baseOptions.map((name) => ({ value: name, label: name }))}
              />
            ) : (
              <p className={styles.hint}>{t("dialog.noBase")}</p>
            )}
          </div>
          <Field
            label={t("dialog.titleField")}
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
            }}
            spellCheck
            autoFocus
          />
          <div className={`${styles.field} ${styles.bodyField}`}>
            <label htmlFor={ids.body} className={styles.label}>
              {t("dialog.body")}
            </label>
            <textarea
              id={ids.body}
              className={styles.body}
              value={body}
              placeholder={t("dialog.bodyPlaceholder")}
              onChange={(e) => {
                setBody(e.target.value);
              }}
            />
          </div>
          <label className={styles.check}>
            <Checkbox
              state={draft ? "checked" : "unchecked"}
              onChange={(e) => setDraft(e.target.checked)}
            />
            {t("dialog.draft")}
          </label>
          {remoteBranch === null && <p className={styles.hint}>{t("dialog.otherRemote")}</p>}
          {nothingToAdd && (
            <p className={styles.hint} role="status">
              {t("dialog.nothingToAdd", { base })}
            </p>
          )}
          {intoItself && (
            <div className={styles.errorBlock} role="status">
              <p className={styles.hint}>{t("dialog.intoItself", { branch: base })}</p>
              <Button
                type="button"
                onClick={() => {
                  onClose();
                  runCommand("branch.create");
                }}
              >
                {t("dialog.newBranch")}
              </Button>
            </div>
          )}
          {!intoItself && unpublished && (
            <p className={styles.hint}>{t("dialog.willPublish", { remote })}</p>
          )}
          {!intoItself && unpushed && (
            <p className={styles.hint}>{t("dialog.willPush", { count: branch.ahead })}</p>
          )}
          {syncBusy && (
            <p className={styles.hint} role="status">
              {t("dialog.busySync")}
            </p>
          )}
          {error && <AccessError error={error} />}
        </div>
        <section className={styles.preview} aria-label={t("dialog.preview")}>
          {!baseRef ? (
            <p className={styles.previewNotice}>{t("dialog.noPreview")}</p>
          ) : comparison.isError ? (
            <div className={styles.previewNotice}>
              <ErrorMessage error={toAppError(comparison.error)} />
            </div>
          ) : !comparison.data ? (
            <Loading />
          ) : (
            <>
              <div className={styles.previewHead}>
                <p className={styles.previewCounts}>
                  {t("dialog.counts", {
                    commits: t("dialog.commits", { count: comparison.data.ahead }),
                    files: t("dialog.files", { count: comparison.data.files.length }),
                  })}
                </p>
                {commits.length > 0 && (
                  <ul className={styles.commits}>
                    {commits.slice(0, SHOWN_COMMITS).map((c) => (
                      <li key={c.oid}>
                        <span className={styles.hash}>{shortHash(c.oid)}</span>{" "}
                        <CommitTitle summary={c.summary} />
                      </li>
                    ))}
                    {comparison.data.ahead > SHOWN_COMMITS && (
                      <li className={styles.more}>
                        {t("dialog.more", { count: comparison.data.ahead - SHOWN_COMMITS })}
                      </li>
                    )}
                  </ul>
                )}
              </div>
              <ChangedFiles
                key={`${comparison.data.from}..${comparison.data.target}`}
                repo={repo}
                files={comparison.data.files}
                source={{
                  kind: "compare",
                  from: comparison.data.from,
                  target: comparison.data.target,
                }}
              />
            </>
          )}
        </section>
      </div>
    </FormDialog>
  );
}

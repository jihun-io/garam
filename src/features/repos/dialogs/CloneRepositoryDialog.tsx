import { useQueryClient } from "@tanstack/react-query";
import { useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { ErrorMessage } from "../../../components/ErrorMessage";
import { Button } from "../../../components/ui/Button";
import { FormDialog } from "../../../components/ui/Dialog";
import { Field } from "../../../components/ui/Field";
import fieldStyles from "../../../components/ui/Field.module.css";
import { Select } from "../../../components/ui/Select";
import {
  commands,
  toAppError,
  unwrap,
  type Account,
  type AppError,
  type Identity,
  type Progress,
} from "../../../ipc";
import { joinPath, repoNameFromUrl } from "../../../lib/paths";
import { useAccounts } from "../../accounts/api";
import {
  accountEmails,
  accountLabel,
  emailBelongsTo,
  parseRemote,
  suggestAccount,
} from "../../accounts/repoAccount";
import { networkChannel } from "../../sync/networkChannel";
import { rememberParentDir } from "../defaultParent";
import { useOpenRepository } from "../openRepository";
import { BrowseButton } from "./BrowseButton";
import styles from "./dialogs.module.css";
import { useParentDir } from "./useParentDir";

// Radix Select can't use "" as a value; no account key looks like this.
const NO_ACCOUNT = "none";

// The author choice that leaves the repository's identity alone.
const KEEP_AUTHOR = "keep";

type CloneState =
  | { status: "form" }
  | { status: "cloning"; progress: Progress | null }
  /** Cloned with an account whose emails don't include the commit author. */
  | { status: "author"; path: string; account: Account; identity: Identity };

export function CloneRepositoryDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation("repos");
  const queryClient = useQueryClient();
  const openRepository = useOpenRepository();
  const [url, setUrl] = useState("");
  // Follows the URL until the user types their own name.
  const [customName, setCustomName] = useState<string | null>(null);
  const [parent, setParent] = useParentDir();
  const accounts = useAccounts().data?.accounts ?? [];
  // Follows the URL's suggestion until the user picks one.
  const [chosenAccount, setChosenAccount] = useState<string | null>(null);
  const [error, setError] = useState<AppError>();
  const [state, setState] = useState<CloneState>({ status: "form" });
  const operationId = useRef<string | null>(null);

  const name = customName ?? repoNameFromUrl(url);
  const remote = parseRemote(url.trim());
  const suggestion = suggestAccount(accounts, remote, null);
  const accountKey = chosenAccount ?? suggestion?.key ?? NO_ACCOUNT;
  const account = accounts.find((a) => a.key === accountKey) ?? null;
  const cloning = state.status === "cloning";
  const ready = url.trim() !== "" && name.trim() !== "" && parent !== "" && !cloning;

  const submit = async () => {
    if (!ready) return;
    const id = crypto.randomUUID();
    operationId.current = id;
    setError(undefined);
    setState({ status: "cloning", progress: null });

    const channel = networkChannel((progress) => {
      if (operationId.current === id) setState({ status: "cloning", progress });
    });
    try {
      const entry = await unwrap(
        commands.repoClone(id, url.trim(), parent, name.trim(), account?.key ?? null, channel),
      );
      rememberParentDir(parent);
      await queryClient.invalidateQueries({ queryKey: ["repositories"] });
      const identity = account ? await mismatchedAuthor(entry.path, account) : null;
      if (account && identity) {
        setState({ status: "author", path: entry.path, account, identity });
        return;
      }
      finish(entry.path);
    } catch (e) {
      const appError = toAppError(e);
      // A cancel is the user's own choice: go back to the form quietly.
      if (appError.kind !== "cancelled") setError(appError);
      setState({ status: "form" });
    } finally {
      operationId.current = null;
    }
  };

  const finish = (path: string) => {
    onClose();
    void openRepository(path);
  };

  const cancelClone = () => {
    if (operationId.current) void commands.operationCancel(operationId.current);
  };

  if (state.status === "author") {
    return <AuthorStep {...state} onDone={() => finish(state.path)} />;
  }

  const footer = cloning ? (
    // Focus moves here when the form is replaced by the progress view.
    <Button onClick={cancelClone} autoFocus>
      {t("clone.cancelClone")}
    </Button>
  ) : (
    <>
      <Button onClick={onClose}>{t("form.cancel")}</Button>
      <Button type="submit" variant="primary" disabled={!ready}>
        {t("clone.submit")}
      </Button>
    </>
  );

  return (
    <FormDialog
      open
      onOpenChange={(open) => !open && !cloning && onClose()}
      title={t("clone.title")}
      onSubmit={() => void submit()}
      dismissible={!cloning}
      footer={footer}
    >
      {cloning ? (
        <CloneProgress name={name.trim()} progress={state.progress} />
      ) : (
        <>
          <Field
            label={t("clone.url")}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            hint={t("clone.urlHint")}
            autoFocus
            inputMode="url"
          />
          {accounts.length > 0 && (
            <AccountField
              value={accountKey}
              onChange={setChosenAccount}
              options={[
                { value: NO_ACCOUNT, label: t("clone.noAccount") },
                ...accounts.map((a) => ({
                  value: a.key,
                  label:
                    a.key === suggestion?.key
                      ? t("clone.suggested", { account: accountLabel(a) })
                      : accountLabel(a),
                })),
              ]}
              hint={
                account === null
                  ? t("clone.noAccountHint")
                  : remote && !remote.https
                    ? t("clone.sshHint")
                    : t("clone.accountHint", { login: account.login })
              }
            />
          )}
          <Field
            label={t("clone.name")}
            value={name}
            onChange={(e) => setCustomName(e.target.value)}
          />
          <Field
            label={t("clone.parent")}
            value={parent}
            onChange={(e) => setParent(e.target.value)}
            trailing={<BrowseButton current={parent} onChoose={setParent} />}
            hint={
              name.trim() && parent
                ? t("form.willBeCreatedAt", { path: joinPath(parent, name.trim()) })
                : undefined
            }
          />
          {error && <ErrorMessage error={error} />}
        </>
      )}
    </FormDialog>
  );
}

/**
 * The repository's commit author when GitHub wouldn't link it to
 * `account`, or `null` when it would. Git settings may already pick the
 * right one (for example `includeIf` by folder), so this reads the new
 * repository's identity rather than the global one.
 */
async function mismatchedAuthor(path: string, account: Account): Promise<Identity | null> {
  try {
    const { effective } = await unwrap(commands.identityGet(path));
    return effective.email && emailBelongsTo(account, effective.email) ? null : effective;
  } catch {
    // Not worth holding up the clone; the author line warns later.
    return null;
  }
}

/** Asks which author a freshly cloned repository should use. */
function AuthorStep({
  path,
  account,
  identity,
  onDone,
}: {
  path: string;
  account: Account;
  identity: Identity;
  onDone: () => void;
}) {
  const { t } = useTranslation("repos");
  const group = useId();
  const emails = accountEmails(account);
  const [choice, setChoice] = useState(emails[0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AppError>();

  const submit = async () => {
    if (busy) return;
    if (choice === KEEP_AUTHOR) return onDone();
    setBusy(true);
    setError(undefined);
    try {
      const name = identity.name ?? account.name ?? account.login;
      await unwrap(commands.identitySetLocal(path, name, choice));
      onDone();
    } catch (e) {
      setError(toAppError(e));
      setBusy(false);
    }
  };

  const option = (value: string, label: string, hint?: string) => (
    <label key={value} className={styles.option}>
      <input
        type="radio"
        name={group}
        value={value}
        checked={choice === value}
        onChange={() => setChoice(value)}
      />
      <span>
        <span className={styles.optionLabel}>{label}</span>
        {hint && <span className={styles.optionHint}>{hint}</span>}
      </span>
    </label>
  );

  return (
    <FormDialog
      open
      // Closing keeps the author as it is, same as choosing to keep it.
      onOpenChange={(open) => !open && !busy && onDone()}
      title={t("clone.author.title")}
      description={
        identity.email
          ? t("clone.author.mismatch", { email: identity.email, login: account.login })
          : t("clone.author.missing", { login: account.login })
      }
      onSubmit={() => void submit()}
      dismissible={!busy}
      footer={
        <Button type="submit" variant="primary" disabled={busy} autoFocus>
          {t("clone.author.continue")}
        </Button>
      }
    >
      <fieldset className={styles.options}>
        <legend className={styles.srOnly}>{t("clone.author.title")}</legend>
        {emails.map((e) =>
          option(e, e, e === account.noreplyEmail ? t("clone.author.noreplyHint") : undefined),
        )}
        {identity.email &&
          option(
            KEEP_AUTHOR,
            t("clone.author.keep", { email: identity.email }),
            t("clone.author.keepHint"),
          )}
      </fieldset>
      {error && <ErrorMessage error={error} />}
    </FormDialog>
  );
}

function AccountField({
  value,
  onChange,
  options,
  hint,
}: {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  hint: string;
}) {
  const { t } = useTranslation("repos");
  const id = useId();
  return (
    <div className={fieldStyles.field}>
      <label htmlFor={id} className={fieldStyles.label}>
        {t("clone.account")}
      </label>
      <Select id={id} value={value} onChange={onChange} options={options} />
      <p className={fieldStyles.hint}>{hint}</p>
    </div>
  );
}

function CloneProgress({ name, progress }: { name: string; progress: Progress | null }) {
  const { t } = useTranslation("repos");
  const percent = progress?.overallPercent ?? 0;
  const phase = progress ? t(`clone.phase.${progress.phase}`) : t("clone.phase.starting");

  return (
    <div className={styles.progress}>
      <p className={styles.progressTitle}>{t("clone.cloning", { name })}</p>
      <div
        className={styles.bar}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={`${phase} ${percent}%`}
      >
        <div className={styles.barFill} style={{ width: `${percent}%` }} />
      </div>
      <p className={styles.progressPhase}>
        <span>{phase}</span>
        <span>{percent}%</span>
      </p>
    </div>
  );
}

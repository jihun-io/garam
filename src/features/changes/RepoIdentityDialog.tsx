import { useId, useState } from "react";
import { useTranslation } from "react-i18next";

import { ErrorMessage } from "../../components/ErrorMessage";
import { Button } from "../../components/ui/Button";
import { FormDialog } from "../../components/ui/Dialog";
import { Field } from "../../components/ui/Field";
import { Select } from "../../components/ui/Select";
import { toAppError, type Account, type Identity, type RepoIdentity } from "../../ipc";
import type { RepoAccount } from "../accounts/api";
import { accountEmails, accountLabel, emailBelongsTo } from "../accounts/repoAccount";
import { useRepositoryActions } from "../repos/api";
import { useChangeActions } from "./api";
import styles from "./RepoIdentityDialog.module.css";

type Mode = "inherit" | "override";

// Radix Select can't use "" as a value; no account key looks like this.
const NO_ACCOUNT = "none";

/**
 * Chooses, for one repository, the GitHub account git signs in with and
 * the commit author: the global identity, or one saved in the repository's
 * own config.
 */
export function RepoIdentityDialog({
  repo,
  identity,
  repoAccount,
  onClose,
}: {
  repo: string;
  identity: RepoIdentity;
  repoAccount: RepoAccount;
  onClose: () => void;
}) {
  const { t } = useTranslation("changes");
  const group = useId();
  const accountId = useId();
  const { setLocalIdentity, clearLocalIdentity } = useChangeActions(repo);
  const { setAccount } = useRepositoryActions();
  const { accounts, remote, suggestion } = repoAccount;

  const [accountKey, setAccountKey] = useState<string>(repoAccount.account?.key ?? NO_ACCOUNT);
  const [mode, setMode] = useState<Mode>(
    identity.local.email || identity.local.name ? "override" : "inherit",
  );
  // Start from the inherited values so only what differs needs typing.
  const [name, setName] = useState(identity.local.name ?? identity.inherited.name ?? "");
  const [email, setEmail] = useState(identity.local.email ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ReturnType<typeof toAppError>>();

  const account = accounts.find((a) => a.key === accountKey) ?? null;
  const showAccounts = accounts.length > 0;
  const ready = !busy && (mode === "inherit" || (name.trim() !== "" && /\S+@\S+/.test(email)));
  // The author email the commit would get, to check against the account.
  const authorEmail = mode === "override" ? email.trim() : identity.inherited.email;

  const submit = async () => {
    if (!ready) return;
    setBusy(true);
    setError(undefined);
    try {
      const nextAccount = accountKey === NO_ACCOUNT ? null : accountKey;
      if (showAccounts && nextAccount !== repoAccount.chosenKey) {
        await setAccount.mutateAsync({ path: repo, account: nextAccount });
      }
      if (mode === "inherit") {
        if (identity.local.name || identity.local.email) await clearLocalIdentity.mutateAsync();
      } else {
        await setLocalIdentity.mutateAsync({ name: name.trim(), email: email.trim() });
      }
      onClose();
    } catch (e) {
      setError(toAppError(e));
    } finally {
      setBusy(false);
    }
  };

  const option = (value: Mode, label: string, hint: string) => (
    <label className={styles.option}>
      <input
        type="radio"
        name={group}
        value={value}
        checked={mode === value}
        onChange={() => setMode(value)}
      />
      <span>
        <span className={styles.optionLabel}>{label}</span>
        <span className={styles.optionHint}>{hint}</span>
      </span>
    </label>
  );

  const optionLabel = (a: Account) =>
    a.key === suggestion?.key
      ? t("repoIdentity.suggested", { account: accountLabel(a) })
      : accountLabel(a);

  return (
    <FormDialog
      open
      onOpenChange={(open) => !open && !busy && onClose()}
      title={showAccounts ? t("repoIdentity.titleWithAccount") : t("repoIdentity.title")}
      onSubmit={() => void submit()}
      dismissible={!busy}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            {t("repoIdentity.cancel")}
          </Button>
          <Button type="submit" variant="primary" disabled={!ready}>
            {t("repoIdentity.save")}
          </Button>
        </>
      }
    >
      {showAccounts && (
        <div className={styles.section}>
          <label htmlFor={accountId} className={styles.sectionLabel}>
            {t("repoIdentity.account")}
          </label>
          <Select
            id={accountId}
            value={accountKey}
            onChange={setAccountKey}
            options={[
              { value: NO_ACCOUNT, label: t("repoIdentity.noAccount") },
              ...accounts.map((a) => ({ value: a.key, label: optionLabel(a) })),
            ]}
          />
          <p className={styles.optionHint}>
            {account === null
              ? t("repoIdentity.noAccountHint")
              : remote && !remote.https
                ? t("repoIdentity.sshHint")
                : t("repoIdentity.accountHint", { login: account.login })}
          </p>
        </div>
      )}

      <fieldset className={styles.options}>
        <legend className={styles.sectionLabel}>{t("repoIdentity.author")}</legend>
        {option(
          "inherit",
          t("repoIdentity.inherit"),
          formatIdentity(identity.inherited) ?? t("repoIdentity.inheritMissing"),
        )}
        {option("override", t("repoIdentity.override"), t("repoIdentity.overrideHint"))}
      </fieldset>
      {mode === "override" && (
        <>
          <Field
            label={t("identity.name")}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Field
            label={t("identity.email")}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={identity.inherited.email ?? undefined}
            autoFocus
          />
          {account && (
            <div
              className={styles.emails}
              role="group"
              aria-label={t("repoIdentity.accountEmails")}
            >
              {accountEmails(account).map((e) => (
                <Button key={e} variant="ghost" onClick={() => setEmail(e)}>
                  {e}
                </Button>
              ))}
            </div>
          )}
        </>
      )}
      {account && authorEmail && !emailBelongsTo(account, authorEmail) && (
        <p className={styles.warning} role="status">
          {t("repoIdentity.mismatch", { email: authorEmail, login: account.login })}
        </p>
      )}
      {error && <ErrorMessage error={error} />}
    </FormDialog>
  );
}

/** "Name <email>", or whichever part is set. */
export function formatIdentity(identity: Identity): string | null {
  const { name, email } = identity;
  if (name && email) return `${name} <${email}>`;
  return name ?? email ?? null;
}

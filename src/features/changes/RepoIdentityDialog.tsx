import { useId, useState } from "react";
import { useTranslation } from "react-i18next";

import { ErrorMessage } from "../../components/ErrorMessage";
import { Button } from "../../components/ui/Button";
import { FormDialog } from "../../components/ui/Dialog";
import { Field } from "../../components/ui/Field";
import { Select } from "../../components/ui/Select";
import {
  toAppError,
  type Account,
  type Identity,
  type RepoIdentity,
  type RepoSshKey,
  type SshKey,
} from "../../ipc";
import { useRepoSshKey, useSetRepoSshKey, useSshKeys, type RepoAccount } from "../accounts/api";
import { accountEmails, accountLabel, emailBelongsTo } from "../accounts/repoAccount";
import { useRepositoryActions } from "../repos/api";
import { useChangeActions } from "./api";
import styles from "./RepoIdentityDialog.module.css";

type Mode = "inherit" | "override";

// Radix Select can't use "" as a value; no account key looks like this.
const NO_ACCOUNT = "none";
// SSH choices that aren't key paths (paths always contain a separator).
const SSH_DEFAULT = "default";
const SSH_CUSTOM = "custom";

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
  const sshId = useId();
  const { setLocalIdentity, clearLocalIdentity } = useChangeActions(repo);
  const { setAccount } = useRepositoryActions();
  const { accounts, remote, suggestion } = repoAccount;
  const ssh = remote !== null && !remote.https;
  const keys = useSshKeys(ssh).data;
  const repoKey = useRepoSshKey(repo, ssh).data;
  const setSshKey = useSetRepoSshKey(repo);
  // Follows the repository's setting until the user picks one.
  const [sshChoice, setSshChoice] = useState<string | null>(null);

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
  const currentSsh = sshValue(repoKey);
  const sshKey = sshChoice ?? currentSsh;
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
      if (ssh && sshKey !== currentSsh && sshKey !== SSH_CUSTOM) {
        await setSshKey.mutateAsync(sshKey === SSH_DEFAULT ? null : sshKey);
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

      {ssh && keys && repoKey && (
        <div className={styles.section}>
          <label htmlFor={sshId} className={styles.sectionLabel}>
            {t("repoIdentity.sshKey")}
          </label>
          <Select
            id={sshId}
            value={sshKey}
            onChange={setSshChoice}
            options={sshOptions(keys, repoKey, account).map(({ value, label, suggested }) => ({
              value,
              label:
                value === SSH_DEFAULT
                  ? t("repoIdentity.sshDefault")
                  : value === SSH_CUSTOM
                    ? t("repoIdentity.sshCustom")
                    : suggested
                      ? t("repoIdentity.suggested", { account: label })
                      : label,
            }))}
          />
          <p className={styles.optionHint}>
            {sshKey === SSH_DEFAULT
              ? keys.length === 0
                ? t("repoIdentity.sshNoKeys")
                : t("repoIdentity.sshDefaultHint")
              : sshKey === SSH_CUSTOM && repoKey.type === "custom"
                ? t("repoIdentity.sshCustomHint", { command: repoKey.command })
                : t("repoIdentity.sshKeyHint")}
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

/** The Select value for what the repository sets now. */
function sshValue(repoKey: RepoSshKey | undefined): string {
  if (repoKey?.type === "key") return repoKey.path;
  if (repoKey?.type === "custom") return SSH_CUSTOM;
  return SSH_DEFAULT;
}

/**
 * The SSH choices: the usual setup, the repository's own command when
 * Garam didn't write it, then each key. A key whose comment is one of the
 * account's emails is marked as suggested.
 */
function sshOptions(
  keys: SshKey[],
  repoKey: RepoSshKey,
  account: Account | null,
): { value: string; label: string; suggested: boolean }[] {
  const listed = [...keys];
  // A key set earlier that's no longer in ~/.ssh (moved, or elsewhere).
  if (repoKey.type === "key" && !keys.some((k) => k.path === repoKey.path)) {
    listed.push({ path: repoKey.path, kind: "", comment: null });
  }
  return [
    { value: SSH_DEFAULT, label: "", suggested: false },
    ...(repoKey.type === "custom" ? [{ value: SSH_CUSTOM, label: "", suggested: false }] : []),
    ...listed.map((k) => {
      const name = k.path.split(/[\\/]/).pop() ?? k.path;
      return {
        value: k.path,
        label: k.comment ? `${name} (${k.comment})` : name,
        suggested: account !== null && k.comment !== null && emailBelongsTo(account, k.comment),
      };
    }),
  ];
}

/** "Name <email>", or whichever part is set. */
export function formatIdentity(identity: Identity): string | null {
  const { name, email } = identity;
  if (name && email) return `${name} <${email}>`;
  return name ?? email ?? null;
}

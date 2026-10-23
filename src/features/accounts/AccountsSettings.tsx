import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useRef, useState } from "react";
import { Trans, useTranslation } from "react-i18next";

import { ErrorMessage } from "../../components/ErrorMessage";
import { Button } from "../../components/ui/Button";
import { Loading } from "../../components/ui/Loading";
import { commands, toAppError, type Account, type SavedLogin, type SignInCode } from "../../ipc";
import { useNotify } from "../notify/notifyStore";
import { useAccounts, useForgetLogin, useSavedLogins, useSignIn, useSignOut } from "./api";
import styles from "./AccountsSettings.module.css";

/** Signed-in GitHub accounts, and signing in another one. */
export function AccountsSettings() {
  const { t } = useTranslation("settings");
  const accounts = useAccounts();
  if (!accounts.data) return <Loading />;
  const { accounts: list, authorizationSettingsUrl } = accounts.data;

  return (
    <>
      <p className={styles.hint}>{t("accounts.hint")}</p>
      {list.length > 0 ? (
        <ul className={styles.list} aria-label={t("accounts.listLabel")}>
          {list.map((account) => (
            <AccountRow key={account.key} account={account} />
          ))}
        </ul>
      ) : (
        <p className={styles.empty}>{t("accounts.empty")}</p>
      )}
      <SignIn />
      <p className={styles.hint}>
        <Trans
          t={t}
          i18nKey="accounts.revokeHint"
          components={{
            settings: (
              <button
                type="button"
                className={styles.link}
                onClick={() => void openUrl(authorizationSettingsUrl)}
              />
            ),
          }}
        />
      </p>
      <SavedLogins />
    </>
  );
}

/**
 * Logins remembered from the sign-in prompt ("Remember on this computer").
 * Shown only when there are some.
 */
function SavedLogins() {
  const { t } = useTranslation("settings");
  const logins = useSavedLogins().data ?? [];
  if (logins.length === 0) return null;
  return (
    <section className={styles.saved} aria-labelledby="saved-logins">
      <h3 id="saved-logins" className={styles.subheading}>
        {t("accounts.saved.title")}
      </h3>
      <p className={styles.hint}>{t("accounts.saved.hint")}</p>
      <ul className={styles.list} aria-labelledby="saved-logins">
        {logins.map((login) => (
          <SavedLoginRow
            key={`${login.protocol}://${login.username}@${login.host}`}
            login={login}
          />
        ))}
      </ul>
    </section>
  );
}

function SavedLoginRow({ login }: { login: SavedLogin }) {
  const { t } = useTranslation("settings");
  const forget = useForgetLogin();
  const showError = useNotify((s) => s.showError);
  const where = `${login.protocol}://${login.host}`;
  return (
    <li className={styles.account}>
      <span className={styles.names}>
        <span className={styles.name}>{login.username}</span>
        <span className={styles.login}>{where}</span>
      </span>
      <Button
        disabled={forget.isPending}
        aria-label={t("accounts.saved.forgetLabel", { username: login.username, where })}
        onClick={() => forget.mutate(login, { onError: showError })}
      >
        {t("accounts.saved.forget")}
      </Button>
    </li>
  );
}

function AccountRow({ account }: { account: Account }) {
  const { t } = useTranslation("settings");
  const signOut = useSignOut();
  const showError = useNotify((s) => s.showError);
  const [avatarFailed, setAvatarFailed] = useState(false);

  return (
    <li className={styles.account}>
      {avatarFailed ? (
        <span className={styles.avatarFallback} aria-hidden>
          {account.login.slice(0, 1).toUpperCase()}
        </span>
      ) : (
        <img
          className={styles.avatar}
          src={`${account.avatarUrl}${account.avatarUrl.includes("?") ? "&" : "?"}s=64`}
          alt=""
          onError={() => setAvatarFailed(true)}
        />
      )}
      <span className={styles.names}>
        <span className={styles.name}>{account.name ?? account.login}</span>
        <span className={styles.login}>
          @{account.login} · {account.host}
        </span>
      </span>
      <Button
        disabled={signOut.isPending}
        aria-label={t("accounts.signOutLabel", { login: account.login })}
        onClick={() => signOut.mutate(account.key, { onError: showError })}
      >
        {t("accounts.signOut")}
      </Button>
    </li>
  );
}

/** "Add account" and, while signing in, the code to enter on GitHub. */
function SignIn() {
  const { t } = useTranslation("settings");
  const signIn = useSignIn();
  const [code, setCode] = useState<SignInCode | null>(null);
  const [copied, setCopied] = useState(false);
  const operation = useRef<string | null>(null);

  // Leaving the settings stops the polling.
  useEffect(
    () => () => {
      if (operation.current) void commands.operationCancel(operation.current);
    },
    [],
  );

  const copy = async (userCode: string) => {
    try {
      await navigator.clipboard.writeText(userCode);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const start = () => {
    const operationId = crypto.randomUUID();
    operation.current = operationId;
    setCode(null);
    setCopied(false);
    signIn.mutate(
      {
        operationId,
        onCode: (next) => {
          setCode(next);
          void copy(next.userCode);
          void openUrl(next.verificationUri);
        },
      },
      {
        onSettled: () => {
          operation.current = null;
          setCode(null);
        },
      },
    );
  };

  const cancel = () => {
    if (operation.current) void commands.operationCancel(operation.current);
  };

  const error = signIn.error ? toAppError(signIn.error) : null;

  if (!signIn.isPending) {
    return (
      <div className={styles.signIn}>
        <Button variant="primary" onClick={start}>
          {t("accounts.add")}
        </Button>
        {error && error.kind !== "cancelled" && <ErrorMessage error={error} />}
      </div>
    );
  }

  return (
    <section className={styles.pending} aria-labelledby="sign-in-title" aria-live="polite">
      <h4 id="sign-in-title" className={styles.pendingTitle}>
        {t("accounts.pendingTitle")}
      </h4>
      {code ? (
        <>
          <p>{copied ? t("accounts.codeCopied") : t("accounts.codeManual")}</p>
          <code className={styles.code} aria-label={t("accounts.codeLabel")}>
            {code.userCode}
          </code>
          <p className={styles.hint}>{t("accounts.waiting")}</p>
          <div className={styles.actions}>
            <Button onClick={() => void copy(code.userCode)}>{t("accounts.copyCode")}</Button>
            <Button onClick={() => void openUrl(code.verificationUri)}>
              {t("accounts.openBrowser")}
            </Button>
            <Button variant="ghost" onClick={cancel}>
              {t("accounts.cancel")}
            </Button>
          </div>
        </>
      ) : (
        <Loading />
      )}
    </section>
  );
}

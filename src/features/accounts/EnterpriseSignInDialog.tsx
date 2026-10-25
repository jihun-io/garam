import { openUrl } from "@tauri-apps/plugin-opener";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { ErrorMessage } from "../../components/ErrorMessage";
import { Button } from "../../components/ui/Button";
import { FormDialog } from "../../components/ui/Dialog";
import { Field } from "../../components/ui/Field";
import { commands, toAppError, unwrap, type AppError } from "../../ipc";
import { useSignInWithToken } from "./api";

/**
 * Signs in to a GitHub Enterprise Server. The device flow needs an OAuth
 * App registered on each server, so the user makes a personal access
 * token there and pastes it here.
 */
export function EnterpriseSignInDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation("settings");
  const signIn = useSignInWithToken();
  const [host, setHost] = useState("");
  const [token, setToken] = useState("");
  const [linkError, setLinkError] = useState<AppError>();
  const busy = signIn.isPending;
  const ready = host.trim() !== "" && token.trim() !== "" && !busy;

  const submit = () => {
    if (!ready) return;
    signIn.mutate({ host, token }, { onSuccess: onClose });
  };

  const openTokenPage = async () => {
    setLinkError(undefined);
    try {
      await openUrl(await unwrap(commands.githubNewTokenUrl(host)));
    } catch (e) {
      setLinkError(toAppError(e));
    }
  };

  const error = linkError ?? (signIn.error ? toAppError(signIn.error) : undefined);

  return (
    <FormDialog
      open
      onOpenChange={(open) => !open && !busy && onClose()}
      title={t("accounts.enterprise.title")}
      description={t("accounts.enterprise.description")}
      onSubmit={submit}
      dismissible={!busy}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            {t("accounts.cancel")}
          </Button>
          <Button type="submit" variant="primary" disabled={!ready}>
            {t("accounts.enterprise.submit")}
          </Button>
        </>
      }
    >
      <Field
        label={t("accounts.enterprise.host")}
        value={host}
        onChange={(e) => setHost(e.target.value)}
        placeholder="github.example.com"
        hint={t("accounts.enterprise.hostHint")}
        inputMode="url"
        autoFocus
      />
      <Field
        label={t("accounts.enterprise.token")}
        type="password"
        autoComplete="off"
        value={token}
        onChange={(e) => setToken(e.target.value)}
        hint={t("accounts.enterprise.tokenHint")}
        trailing={
          <Button icon="openIn" disabled={host.trim() === ""} onClick={() => void openTokenPage()}>
            {t("accounts.enterprise.createToken")}
          </Button>
        }
      />
      {error && <ErrorMessage error={error} />}
    </FormDialog>
  );
}

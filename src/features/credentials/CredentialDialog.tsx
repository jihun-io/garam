import { useId, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "../../components/ui/Button";
import { Checkbox } from "../../components/ui/Checkbox";
import { FormDialog } from "../../components/ui/Dialog";
import { Field } from "../../components/ui/Field";
import { Icon } from "../../components/Icon";
import styles from "./CredentialDialog.module.css";
import { useCredentials, type PendingCredential } from "./credentialStore";

/** Asks for whatever git or ssh is waiting on, one prompt at a time. */
export function CredentialDialog() {
  const request = useCredentials((s) => s.queue[0]);
  // Keyed so each prompt starts with an empty field.
  return request ? <Prompt key={request.requestId} request={request} /> : null;
}

function Prompt({ request }: { request: PendingCredential }) {
  const { t } = useTranslation("credentials");
  const respond = useCredentials((s) => s.respond);
  const [answer, setAnswer] = useState("");
  // Without a credential helper git forgets every login; offered only then.
  const [remember, setRemember] = useState(true);
  const rememberId = useId();
  const { kind, target, fingerprint, text } = request.prompt;
  const values = { target: target ?? t("unknownTarget") };
  const hostKey = kind === "host_key";
  const secret = kind !== "username" && !hostKey;
  // A credential helper remembers what git asks for (HTTPS); ssh asks for
  // a key's passphrase each time unless an agent holds the key.
  const note =
    kind === "username" || kind === "password"
      ? t("saved")
      : kind === "ssh_passphrase"
        ? t("ssh_passphrase.note")
        : null;

  const cancel = () => respond(request.requestId, null);
  const submit = () =>
    respond(request.requestId, hostKey ? "yes" : answer, request.canRemember && remember);

  return (
    <FormDialog
      open
      onOpenChange={(open) => !open && cancel()}
      title={t(`${kind}.title`)}
      onSubmit={submit}
      footer={
        <>
          <Button onClick={cancel}>{t("cancel")}</Button>
          <Button type="submit" variant="primary">
            {hostKey ? t("trust") : t("submit")}
          </Button>
        </>
      }
    >
      <p className={styles.body}>{t(`${kind}.body`, values)}</p>
      {kind === "other" && <pre className={styles.raw}>{text.trim()}</pre>}
      {hostKey ? (
        <div className={styles.fingerprint}>
          <span className={styles.label}>{t("host_key.label")}</span>
          <code>{fingerprint ?? text.trim()}</code>
        </div>
      ) : (
        <>
          {request.retry && secret && (
            <p className={styles.retry} role="alert">
              <Icon name="error" size={14} />
              {t("retry")}
            </p>
          )}
          <Field
            label={t(`${kind}.label`)}
            type={secret ? "password" : "text"}
            autoComplete="off"
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            hint={kind === "password" ? t("password.hint") : undefined}
            autoFocus
          />
          {request.canRemember ? (
            <label className={styles.remember} htmlFor={rememberId}>
              <Checkbox
                id={rememberId}
                state={remember ? "checked" : "unchecked"}
                onChange={(e) => setRemember(e.target.checked)}
              />
              <span>
                <span>{t("remember.label")}</span>
                <span className={styles.note}>{t("remember.hint")}</span>
              </span>
            </label>
          ) : (
            note && <p className={styles.note}>{note}</p>
          )}
        </>
      )}
    </FormDialog>
  );
}

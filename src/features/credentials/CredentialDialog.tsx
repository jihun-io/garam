import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "../../components/ui/Button";
import { FormDialog } from "../../components/ui/Dialog";
import { Field } from "../../components/ui/Field";
import type { CredentialRequest } from "../../ipc";
import styles from "./CredentialDialog.module.css";
import { useCredentials } from "./credentialStore";

/** Asks for whatever git or ssh is waiting on, one prompt at a time. */
export function CredentialDialog() {
  const request = useCredentials((s) => s.queue[0]);
  // Keyed so each prompt starts with an empty field.
  return request ? <Prompt key={request.requestId} request={request} /> : null;
}

function Prompt({ request }: { request: CredentialRequest }) {
  const { t } = useTranslation("credentials");
  const respond = useCredentials((s) => s.respond);
  const [answer, setAnswer] = useState("");
  const { kind, target, fingerprint, text } = request.prompt;
  const values = { target: target ?? t("unknownTarget") };
  const hostKey = kind === "host_key";
  const secret = kind !== "username" && !hostKey;

  const cancel = () => respond(request.requestId, null);
  const submit = () => respond(request.requestId, hostKey ? "yes" : answer);

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
          <Field
            label={t(`${kind}.label`)}
            type={secret ? "password" : "text"}
            autoComplete="off"
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            hint={kind === "password" ? t("password.hint") : undefined}
            autoFocus
          />
          <p className={styles.note}>{t("saved")}</p>
        </>
      )}
    </FormDialog>
  );
}

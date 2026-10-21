import { useState } from "react";
import { useTranslation } from "react-i18next";

import { ErrorMessage } from "../../components/ErrorMessage";
import { Button } from "../../components/ui/Button";
import { FormDialog } from "../../components/ui/Dialog";
import { Field } from "../../components/ui/Field";
import { toAppError, type Identity } from "../../ipc";
import { useChangeActions } from "./api";

/** Asks for user.name/user.email, saves them globally, then continues. */
export function IdentityDialog({
  repo,
  current,
  onSaved,
  onClose,
}: {
  repo: string;
  current: Identity | undefined;
  onSaved: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation("changes");
  const { setIdentity } = useChangeActions(repo);
  const [name, setName] = useState(current?.name ?? "");
  const [email, setEmail] = useState(current?.email ?? "");
  const ready = name.trim() !== "" && /\S+@\S+/.test(email) && !setIdentity.isPending;

  return (
    <FormDialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={t("identity.title")}
      onSubmit={() =>
        ready &&
        setIdentity.mutate({ name: name.trim(), email: email.trim() }, { onSuccess: onSaved })
      }
      footer={
        <>
          <Button onClick={onClose}>{t("identity.cancel")}</Button>
          <Button type="submit" variant="primary" disabled={!ready}>
            {t("identity.save")}
          </Button>
        </>
      }
    >
      <p>{t("identity.body")}</p>
      <Field
        label={t("identity.name")}
        value={name}
        onChange={(e) => setName(e.target.value)}
        autoFocus
      />
      <Field
        label={t("identity.email")}
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      {setIdentity.error && <ErrorMessage error={toAppError(setIdentity.error)} />}
    </FormDialog>
  );
}

import { useId, useState } from "react";
import { useTranslation } from "react-i18next";

import { ErrorMessage } from "../../components/ErrorMessage";
import { Button } from "../../components/ui/Button";
import { FormDialog } from "../../components/ui/Dialog";
import { Field } from "../../components/ui/Field";
import { toAppError, type Identity, type RepoIdentity } from "../../ipc";
import { useChangeActions } from "./api";
import styles from "./RepoIdentityDialog.module.css";

type Mode = "inherit" | "override";

/**
 * Chooses the author for one repository: the global identity, or one saved
 * in the repository's own config.
 */
export function RepoIdentityDialog({
  repo,
  identity,
  onClose,
}: {
  repo: string;
  identity: RepoIdentity;
  onClose: () => void;
}) {
  const { t } = useTranslation("changes");
  const group = useId();
  const { setLocalIdentity, clearLocalIdentity } = useChangeActions(repo);
  const [mode, setMode] = useState<Mode>(
    identity.local.email || identity.local.name ? "override" : "inherit",
  );
  // Start from the inherited values so only what differs needs typing.
  const [name, setName] = useState(identity.local.name ?? identity.inherited.name ?? "");
  const [email, setEmail] = useState(identity.local.email ?? "");
  const pending = setLocalIdentity.isPending || clearLocalIdentity.isPending;
  const error = setLocalIdentity.error ?? clearLocalIdentity.error;
  const ready = !pending && (mode === "inherit" || (name.trim() !== "" && /\S+@\S+/.test(email)));

  const submit = () => {
    if (!ready) return;
    if (mode === "inherit") {
      clearLocalIdentity.mutate(undefined, { onSuccess: onClose });
    } else {
      setLocalIdentity.mutate({ name: name.trim(), email: email.trim() }, { onSuccess: onClose });
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

  return (
    <FormDialog
      open
      onOpenChange={(open) => !open && !pending && onClose()}
      title={t("repoIdentity.title")}
      onSubmit={submit}
      dismissible={!pending}
      footer={
        <>
          <Button onClick={onClose} disabled={pending}>
            {t("repoIdentity.cancel")}
          </Button>
          <Button type="submit" variant="primary" disabled={!ready}>
            {t("repoIdentity.save")}
          </Button>
        </>
      }
    >
      <fieldset className={styles.options}>
        <legend className={styles.srOnly}>{t("repoIdentity.title")}</legend>
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
        </>
      )}
      {error && <ErrorMessage error={toAppError(error)} />}
    </FormDialog>
  );
}

/** "Name <email>", or whichever part is set. */
export function formatIdentity(identity: Identity): string | null {
  const { name, email } = identity;
  if (name && email) return `${name} <${email}>`;
  return name ?? email ?? null;
}

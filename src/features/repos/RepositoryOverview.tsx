import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "../../components/ui/Button";
import type { RepositoryEntry } from "../../ipc";
import { useNotify } from "../notify/notifyStore";
import { useRepositoryActions } from "./api";
import { chooseDirectory } from "./chooseDirectory";
import styles from "./RepositoryOverview.module.css";

/** The selected repository's home. M2 replaces the body with changes. */
export function RepositoryOverview({ repository }: { repository: RepositoryEntry }) {
  const { t } = useTranslation("repos");
  const { add, remove, select } = useRepositoryActions();
  const showError = useNotify((s) => s.showError);
  const [copied, setCopied] = useState(false);

  const copyPath = async () => {
    try {
      await navigator.clipboard.writeText(repository.path);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (e) {
      showError(e);
    }
  };

  // Re-adds the repository from its new location and drops the stale entry.
  const locate = async () => {
    const dir = await chooseDirectory();
    if (!dir) return;
    add.mutate(dir, {
      onSuccess: (entry) => {
        select.mutate(entry.path);
        if (entry.path !== repository.path) remove.mutate(repository.path);
      },
      onError: showError,
    });
  };

  return (
    <section className={styles.root} aria-labelledby="repo-name">
      <h1 id="repo-name" className={styles.name}>
        {repository.name}
      </h1>
      <div className={styles.pathRow}>
        <code className={styles.path}>{repository.path}</code>
        <Button variant="ghost" onClick={() => void copyPath()} aria-live="polite">
          {copied ? t("overview.copied") : t("overview.copyPath")}
        </Button>
      </div>

      {repository.missing && (
        <div className={styles.missing} role="alert">
          <h2 className={styles.missingTitle}>{t("overview.missingTitle")}</h2>
          <p>{t("overview.missingBody")}</p>
          <div className={styles.actions}>
            <Button variant="primary" onClick={() => void locate()}>
              {t("overview.locate")}
            </Button>
            <Button onClick={() => remove.mutate(repository.path, { onError: showError })}>
              {t("overview.remove")}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

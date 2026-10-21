import { useTranslation } from "react-i18next";

import { RiverMark } from "../../components/RiverMark";
import { LanguageSelect } from "../settings/LanguageSelect";
import startup from "../startup/Startup.module.css";
import { useRepoDialog, type RepoDialog } from "./dialogStore";
import styles from "./EmptyState.module.css";

const ACTIONS = [
  { kind: "add", title: "actions.add", description: "actions.addDescription" },
  { kind: "clone", title: "actions.clone", description: "actions.cloneDescription" },
  { kind: "create", title: "actions.create", description: "actions.createDescription" },
] as const satisfies readonly {
  kind: RepoDialog["kind"];
  title: string;
  description: string;
}[];

/** First-run screen: no repositories added yet. */
export function EmptyState({ gitVersion }: { gitVersion: string }) {
  const { t } = useTranslation(["repos", "startup", "common"]);
  const open = useRepoDialog((s) => s.open);

  return (
    <main className={startup.screen}>
      <div className={startup.column}>
        <RiverMark />
        <h1 className={startup.wordmark}>{t("common:appName")}</h1>
        <p className={startup.tagline}>{t("startup:tagline")}</p>

        <section className={styles.start} aria-labelledby="empty-title">
          <h2 id="empty-title" className={styles.heading}>
            {t("empty.title")}
          </h2>
          <ul className={styles.actions}>
            {ACTIONS.map((action) => (
              <li key={action.kind}>
                <button
                  type="button"
                  className={styles.action}
                  onClick={() => open({ kind: action.kind })}
                >
                  <span className={styles.actionTitle}>{t(action.title)}</span>
                  <span className={styles.actionDescription}>{t(action.description)}</span>
                </button>
              </li>
            ))}
          </ul>
          <p className={startup.muted}>{t("empty.dropHint")}</p>
        </section>

        <footer className={startup.footer}>
          <span className={startup.muted}>{t("startup:gitReady", { version: gitVersion })}</span>
          <LanguageSelect />
        </footer>
      </div>
    </main>
  );
}

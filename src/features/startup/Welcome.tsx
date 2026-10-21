import { useTranslation } from "react-i18next";

import { RiverMark } from "../../components/RiverMark";
import { LanguageSelect } from "../settings/LanguageSelect";
import styles from "./Startup.module.css";

export function Welcome({ gitVersion }: { gitVersion: string }) {
  const { t } = useTranslation(["startup", "common"]);

  return (
    <main className={styles.screen}>
      <div className={styles.column}>
        <RiverMark />
        <h1 className={styles.wordmark}>{t("common:appName")}</h1>
        <p className={styles.tagline}>{t("tagline")}</p>
        <footer className={styles.footer}>
          <span className={styles.muted}>{t("gitReady", { version: gitVersion })}</span>
          <LanguageSelect />
        </footer>
      </div>
    </main>
  );
}

import { openUrl } from "@tauri-apps/plugin-opener";
import { Trans, useTranslation } from "react-i18next";

import { ErrorMessage } from "../../components/ErrorMessage";
import type { AppError } from "../../ipc";
import { LanguageSelect } from "../settings/LanguageSelect";
import styles from "./Startup.module.css";

const DOWNLOAD_URL = "https://git-scm.com/downloads";

type Platform = "macos" | "windows" | "linux";

function currentPlatform(): Platform {
  const ua = navigator.userAgent;
  if (ua.includes("Mac")) return "macos";
  if (ua.includes("Windows")) return "windows";
  return "linux";
}

/** Shown when the startup git check fails: missing, outdated, or unusable git. */
export function StartupError({
  error,
  retrying,
  onRetry,
}: {
  error: AppError;
  retrying: boolean;
  onRetry: () => void;
}) {
  const { t } = useTranslation("startup");
  const missing = error.kind === "git_not_found";
  const tooOld = error.kind === "git_too_old";

  const title = missing
    ? t("missing.title")
    : tooOld
      ? t("missing.updateTitle")
      : t("missing.checkFailedTitle");

  return (
    <main className={styles.screen}>
      <div className={styles.column}>
        <h1 className={styles.title}>{title}</h1>
        <ErrorMessage error={error} />
        {missing && (
          <p>
            <Trans t={t} i18nKey={`missing.${currentPlatform()}`} components={{ code: <code /> }} />
          </p>
        )}
        <div className={styles.actions}>
          {(missing || tooOld) && (
            <button
              type="button"
              className={styles.primary}
              onClick={() => void openUrl(DOWNLOAD_URL)}
            >
              {t("missing.download")}
            </button>
          )}
          <button type="button" className={styles.secondary} disabled={retrying} onClick={onRetry}>
            {t("missing.retry")}
          </button>
        </div>
        {missing && (
          <p className={styles.muted}>
            <Trans t={t} i18nKey="missing.customPath" components={{ code: <code /> }} />
          </p>
        )}
        <footer className={styles.footer}>
          <LanguageSelect />
        </footer>
      </div>
    </main>
  );
}

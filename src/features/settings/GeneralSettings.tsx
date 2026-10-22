import { useTranslation } from "react-i18next";

import { Button } from "../../components/ui/Button";
import { commands } from "../../ipc";
import { currentPlatform } from "../../lib/platform";
import { getLaunchLanguage, useSettings } from "./api";
import { LanguageSelect } from "./LanguageSelect";
import styles from "./SettingsDialog.module.css";

export function GeneralSettings() {
  const { t } = useTranslation("settings");
  const { language } = useSettings();
  const launchLanguage = getLaunchLanguage();
  // macOS adds some menu items itself and localizes them only at launch.
  const needsRestart = currentPlatform() === "macos" && language !== launchLanguage;

  return (
    <>
      <LanguageSelect />
      {needsRestart && (
        <div className={styles.setting}>
          <p className={styles.hint}>{t("general.restartHint")}</p>
          <Button onClick={() => void commands.appRestart()}>{t("general.restart")}</Button>
        </div>
      )}
    </>
  );
}

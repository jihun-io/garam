import { useTranslation } from "react-i18next";

import { Button } from "../../components/ui/Button";
import { Select } from "../../components/ui/Select";
import { commands, type OpenRepositoryIn } from "../../ipc";
import { currentPlatform } from "../../lib/platform";
import { getLaunchLanguage, useSettings, useUpdateSettings } from "./api";
import { Setting } from "./controls";
import { LanguageSelectControl } from "./LanguageSelect";
import styles from "./SettingsDialog.module.css";

const OPEN_REPOSITORY_IN: OpenRepositoryIn[] = ["ask", "current_window", "new_window"];

export function GeneralSettings() {
  const { t } = useTranslation(["settings", "common"]);
  const { language, openRepositoryIn } = useSettings();
  const update = useUpdateSettings();
  const launchLanguage = getLaunchLanguage();
  // macOS adds some menu items itself and localizes them only at launch.
  const needsRestart = currentPlatform() === "macos" && language !== launchLanguage;

  return (
    <>
      <Setting label={t("common:language.label")}>
        {(id) => <LanguageSelectControl id={id} />}
      </Setting>
      {needsRestart && (
        <div className={styles.setting}>
          <p className={styles.hint}>{t("general.restartHint")}</p>
          <Button onClick={() => void commands.appRestart()}>{t("general.restart")}</Button>
        </div>
      )}
      <Setting label={t("general.openRepositoryIn")} hint={t("general.openRepositoryInHint")}>
        {(id) => (
          <Select
            id={id}
            value={openRepositoryIn}
            options={OPEN_REPOSITORY_IN.map((value) => ({
              value,
              label: t(`general.openRepositoryInChoices.${value}`),
            }))}
            onChange={(value) => update({ openRepositoryIn: value as OpenRepositoryIn })}
          />
        )}
      </Setting>
    </>
  );
}

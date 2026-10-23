import { useTranslation } from "react-i18next";

import { Button } from "../../components/ui/Button";
import { Select } from "../../components/ui/Select";
import { commands, type OpenRepositoryIn } from "../../ipc";
import { isCommandEnabled, runCommand, useCommandsVersion } from "../../lib/commands";
import { currentPlatform } from "../../lib/platform";
import { useAppVersion } from "../update/api";
import { useLaunchLanguage, useSettings, useUpdateSettings } from "./api";
import { Setting } from "./controls";
import { LanguageSelectControl } from "./LanguageSelect";
import styles from "./Settings.module.css";

const OPEN_REPOSITORY_IN: OpenRepositoryIn[] = ["ask", "current_window", "new_window"];

export function GeneralSettings() {
  const { t } = useTranslation(["settings", "common"]);
  const { language, openRepositoryIn, checkForUpdates, commitChecks } = useSettings();
  const update = useUpdateSettings();
  const launchLanguage = useLaunchLanguage();
  // macOS adds some menu items itself and localizes them only at launch.
  const needsRestart =
    currentPlatform() === "macos" && launchLanguage.isSuccess && language !== launchLanguage.data;

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
      <Setting label={t("general.commitChecks")} hint={t("general.commitChecksHint")}>
        {(id) => (
          <Select
            id={id}
            value={commitChecks ? "on" : "off"}
            options={(["on", "off"] as const).map((value) => ({
              value,
              label: t(`general.commitChecksChoices.${value}`),
            }))}
            onChange={(value) => update({ commitChecks: value === "on" })}
          />
        )}
      </Setting>
      <UpdateSettings
        automatic={checkForUpdates}
        onChange={(automatic) => update({ checkForUpdates: automatic })}
      />
    </>
  );
}

function UpdateSettings({
  automatic,
  onChange,
}: {
  automatic: boolean;
  onChange: (automatic: boolean) => void;
}) {
  const { t } = useTranslation("settings");
  const version = useAppVersion();
  // The button runs the menu's command, so it's off while a check runs.
  useCommandsVersion();
  return (
    <Setting
      label={t("general.updates")}
      hint={version ? t("general.updatesHint", { version }) : undefined}
    >
      {(id) => (
        <div className={styles.row}>
          <Select
            id={id}
            value={automatic ? "automatic" : "manual"}
            options={(["automatic", "manual"] as const).map((value) => ({
              value,
              label: t(`general.updatesChoices.${value}`),
            }))}
            onChange={(value) => onChange(value === "automatic")}
          />
          <Button
            disabled={!isCommandEnabled("app.checkUpdates")}
            onClick={() => runCommand("app.checkUpdates")}
          >
            {t("general.checkNow")}
          </Button>
        </div>
      )}
    </Setting>
  );
}

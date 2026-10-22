import { useId } from "react";
import { useTranslation } from "react-i18next";

import { LANGUAGES } from "../../i18n";
import { useSettings, useUpdateSettings } from "./api";
import styles from "./LanguageSelect.module.css";

/** Saved in settings; "system" follows the operating system's language. */
export function LanguageSelect() {
  const { t } = useTranslation();
  const id = useId();
  const settings = useSettings();
  const update = useUpdateSettings();

  return (
    <div className={styles.root}>
      <label htmlFor={id}>{t("language.label")}</label>
      <select
        id={id}
        className={styles.select}
        value={settings.language ?? "system"}
        onChange={(e) => update({ language: e.target.value === "system" ? null : e.target.value })}
      >
        <option value="system">{t("language.system")}</option>
        {LANGUAGES.map(({ code, label }) => (
          <option key={code} value={code} lang={code}>
            {label}
          </option>
        ))}
      </select>
    </div>
  );
}

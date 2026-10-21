import { useId } from "react";
import { useTranslation } from "react-i18next";

import { LANGUAGES, changeLanguage, type Language } from "../../i18n";
import styles from "./LanguageSelect.module.css";

export function LanguageSelect() {
  const { t, i18n } = useTranslation();
  const id = useId();

  return (
    <div className={styles.root}>
      <label htmlFor={id}>{t("language.label")}</label>
      <select
        id={id}
        className={styles.select}
        value={i18n.resolvedLanguage}
        onChange={(e) => void changeLanguage(e.target.value as Language)}
      >
        {LANGUAGES.map(({ code, label }) => (
          <option key={code} value={code} lang={code}>
            {label}
          </option>
        ))}
      </select>
    </div>
  );
}

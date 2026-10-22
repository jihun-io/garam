import { useId } from "react";
import { useTranslation } from "react-i18next";

import { Select } from "../../components/ui/Select";
import { LANGUAGES } from "../../i18n";
import { useSettings, useUpdateSettings } from "./api";
import styles from "./LanguageSelect.module.css";

/** Compact labelled picker for screens outside the settings dialog. */
export function LanguageSelect() {
  const { t } = useTranslation();
  const id = useId();

  return (
    <div className={styles.root}>
      <label htmlFor={id}>{t("language.label")}</label>
      <LanguageSelectControl id={id} />
    </div>
  );
}

/** Saved in settings; "system" follows the operating system's language. */
export function LanguageSelectControl({ id }: { id: string }) {
  const { t } = useTranslation();
  const settings = useSettings();
  const update = useUpdateSettings();

  return (
    <Select
      id={id}
      value={settings.language ?? "system"}
      onChange={(value) => update({ language: value === "system" ? null : value })}
      options={[
        { value: "system", label: t("language.system") },
        ...LANGUAGES.map(({ code, label }) => ({ value: code, label, lang: code })),
      ]}
    />
  );
}

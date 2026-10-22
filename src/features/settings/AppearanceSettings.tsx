import { RadioGroup } from "radix-ui";
import { useTranslation } from "react-i18next";

import { Select } from "../../components/ui/Select";

import { Icon } from "../../components/Icon";
import type { Accent, Theme } from "../../ipc";
import { ACCENT_PRESETS, accentPairFrom } from "../../lib/accent";
import { useSettings, useSystemAccent, useUpdateSettings } from "./api";
import { Setting } from "./controls";
import segmented from "../../components/ui/Segmented.module.css";
import styles from "./Settings.module.css";

const THEMES: { value: Theme; icon: "themeSystem" | "themeLight" | "themeDark" }[] = [
  { value: "system", icon: "themeSystem" },
  { value: "light", icon: "themeLight" },
  { value: "dark", icon: "themeDark" },
];

const ACCENTS: Accent[] = ["garam", "blue", "purple", "pink", "orange", "system"];

export function AppearanceSettings() {
  const { t } = useTranslation("settings");
  const settings = useSettings();
  const update = useUpdateSettings();
  const systemAccent = useSystemAccent(true);
  const systemColor = systemAccent.data ? accentPairFrom(systemAccent.data) : null;
  const systemUnavailable = systemAccent.isSuccess && !systemColor;

  const swatch = (accent: Accent) =>
    accent === "system"
      ? (systemColor ?? ACCENT_PRESETS.garam).light
      : ACCENT_PRESETS[accent].light;

  return (
    <>
      <div className={styles.setting}>
        <span className={styles.label} id="theme-label">
          {t("appearance.theme")}
        </span>
        <RadioGroup.Root
          className={segmented.track}
          aria-labelledby="theme-label"
          value={settings.theme}
          onValueChange={(theme) => update({ theme: theme as Theme })}
        >
          {THEMES.map(({ value, icon }) => (
            <RadioGroup.Item key={value} value={value} className={segmented.segment}>
              <Icon name={icon} />
              {t(`appearance.themes.${value}`)}
            </RadioGroup.Item>
          ))}
        </RadioGroup.Root>
      </div>

      <div className={styles.setting}>
        <span className={styles.label} id="accent-label">
          {t("appearance.accent")}
        </span>
        <RadioGroup.Root
          className={styles.swatches}
          aria-labelledby="accent-label"
          orientation="horizontal"
          value={settings.accent}
          onValueChange={(accent) => update({ accent: accent as Accent })}
        >
          {ACCENTS.map((accent) => (
            <RadioGroup.Item
              key={accent}
              value={accent}
              className={styles.swatchItem}
              disabled={accent === "system" && systemUnavailable}
            >
              <span className={styles.swatch} style={{ background: swatch(accent) }}>
                <RadioGroup.Indicator className={styles.swatchCheck}>
                  <Icon name="check" size={14} />
                </RadioGroup.Indicator>
              </span>
              <span className={styles.swatchLabel}>{t(`appearance.accents.${accent}`)}</span>
            </RadioGroup.Item>
          ))}
        </RadioGroup.Root>
        {settings.accent === "system" && !systemUnavailable && (
          <p className={styles.hint}>{t("appearance.accentSystemHint")}</p>
        )}
        {systemUnavailable && (
          <p className={styles.hint}>{t("appearance.accentSystemUnavailable")}</p>
        )}
      </div>

      <Setting label={t("appearance.diffFontSize")}>
        {(id) => (
          <Select
            id={id}
            value={settings.diffFontSize}
            onChange={(diffFontSize) => update({ diffFontSize })}
            options={(["small", "medium", "large"] as const).map((value) => ({
              value,
              label: t(`appearance.diffFontSizes.${value}`),
            }))}
          />
        )}
      </Setting>
    </>
  );
}

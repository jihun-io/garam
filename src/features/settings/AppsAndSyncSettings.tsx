import { useTranslation } from "react-i18next";

import { useEditors } from "../repos/api";
import { useSettings, useTerminals, useUpdateSettings } from "./api";
import { SelectControl, Setting } from "./controls";

const AUTO = "";

/** Default editor and terminal; "first found" stays unset in settings. */
export function AppsSettings() {
  const { t } = useTranslation("settings");
  const settings = useSettings();
  const update = useUpdateSettings();
  const editors = useEditors().data ?? [];
  const terminals = useTerminals().data ?? [];

  const choices = (apps: { id: string; name: string }[]) => [
    {
      value: AUTO,
      label: apps[0] ? t("apps.firstFound", { name: apps[0].name }) : t("apps.noneFound"),
    },
    ...apps.map((app) => ({ value: app.id, label: app.name })),
  ];

  return (
    <>
      <Setting label={t("apps.editor")}>
        {(id) => (
          <SelectControl
            id={id}
            value={settings.editor ?? AUTO}
            options={choices(editors)}
            onChange={(editor) => update({ editor: editor || null })}
          />
        )}
      </Setting>
      <Setting label={t("apps.terminal")}>
        {(id) => (
          <SelectControl
            id={id}
            value={settings.terminal ?? AUTO}
            options={choices(terminals)}
            onChange={(terminal) => update({ terminal: terminal || null })}
          />
        )}
      </Setting>
    </>
  );
}

const INTERVALS = [0, 5, 15, 30, 60];

export function SyncSettings() {
  const { t } = useTranslation("settings");
  const settings = useSettings();
  const update = useUpdateSettings();
  return (
    <Setting label={t("sync.fetchInterval")} hint={t("sync.hint")}>
      {(id) => (
        <SelectControl
          id={id}
          value={String(settings.fetchIntervalMinutes)}
          options={INTERVALS.map((minutes) => ({
            value: String(minutes),
            label: minutes === 0 ? t("sync.off") : t("sync.minutes", { count: minutes }),
          }))}
          onChange={(value) => update({ fetchIntervalMinutes: Number(value) })}
        />
      )}
    </Setting>
  );
}

import { useTranslation } from "react-i18next";

import { Select } from "../../components/ui/Select";

import { useEditors } from "../repos/api";
import { useSettings, useTerminals, useUpdateSettings } from "./api";
import { Setting } from "./controls";

// Radix Select can't use "" as a value; no app id looks like this.
const AUTO = "first-found";

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
          <Select
            id={id}
            value={settings.editor ?? AUTO}
            options={choices(editors)}
            onChange={(editor) => update({ editor: editor === AUTO ? null : editor })}
          />
        )}
      </Setting>
      <Setting label={t("apps.terminal")}>
        {(id) => (
          <Select
            id={id}
            value={settings.terminal ?? AUTO}
            options={choices(terminals)}
            onChange={(terminal) => update({ terminal: terminal === AUTO ? null : terminal })}
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
        <Select
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

import { useQueryClient } from "@tanstack/react-query";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";

import type { AppSettings } from "../../ipc";
import { ACCENT_PRESETS, accentPairFrom, type AccentPair } from "../../lib/accent";
import { setDetailFilesWidth, setSidebarWidth } from "../../lib/layout";
import { setAppearance } from "../../lib/theme";
import { resolveLanguage } from "../../i18n";
import { settingsKeys, useSettings, useSystemAccent } from "./api";

/** The accent colors to use, falling back to Garam green. */
export function resolveAccent(
  accent: AppSettings["accent"],
  systemColor: string | null | undefined,
): AccentPair {
  if (accent === "system") {
    return (systemColor && accentPairFrom(systemColor)) || ACCENT_PRESETS.garam;
  }
  return ACCENT_PRESETS[accent];
}

/** Applies appearance and language settings whenever they change. */
export function SettingsEffects() {
  const settings = useSettings();
  const systemAccent = useSystemAccent(settings.accent === "system");
  const { i18n } = useTranslation();
  const language = resolveLanguage(settings.language);
  const client = useQueryClient();

  // A change saved in another window applies here too.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;
    listen<AppSettings>("settings-changed", ({ payload }) => {
      client.setQueryData(settingsKeys.app, payload);
    })
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      })
      .catch(() => {
        // Not running inside Tauri: there is only one window.
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [client]);

  useEffect(() => {
    setAppearance({
      theme: settings.theme,
      accent: resolveAccent(settings.accent, systemAccent.data),
      diffFontSize: settings.diffFontSize,
    });
  }, [settings.theme, settings.accent, settings.diffFontSize, systemAccent.data]);

  useEffect(() => {
    if (i18n.language !== language) void i18n.changeLanguage(language);
  }, [i18n, language]);

  useEffect(() => setSidebarWidth(settings.sidebarWidth), [settings.sidebarWidth]);
  useEffect(() => setDetailFilesWidth(settings.detailFilesWidth), [settings.detailFilesWidth]);

  // The native parts of the window (title bar, menus) follow the theme too.
  useEffect(() => {
    try {
      const theme = settings.theme === "system" ? null : settings.theme;
      void getCurrentWindow()
        .setTheme(theme)
        .catch(() => {});
    } catch {
      // Not running inside Tauri.
    }
  }, [settings.theme]);

  return null;
}

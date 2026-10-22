import React from "react";
import ReactDOM from "react-dom/client";

import i18n, { resolveLanguage, takeLegacyLanguage } from "./i18n";
import "./styles/global.css";
import { App, queryClient } from "./app/App";
import { commands, unwrap } from "./ipc";
import { preloadSettings, rememberLaunchLanguage, settingsKeys } from "./features/settings/api";
import { resolveAccent } from "./features/settings/SettingsEffects";
import { installContextMenuGuard } from "./lib/contextMenu";
import { setSidebarWidth } from "./lib/layout";
import { initTheme, setAppearance } from "./lib/theme";
import { initWindowChrome } from "./lib/windowChrome";

/** Loads settings and applies them before the first frame is drawn. */
async function start() {
  initWindowChrome();
  initTheme();
  installContextMenuGuard();

  let settings = await preloadSettings(queryClient);
  // Versions before settings.json kept the language in the webview.
  const legacy = takeLegacyLanguage();
  if (legacy && settings.language === null) {
    settings = { ...settings, language: legacy };
    queryClient.setQueryData(settingsKeys.app, settings);
    void commands.settingsSet(settings).catch(() => {});
  }

  const systemAccent =
    settings.accent === "system"
      ? await unwrap(commands.systemAccentColor()).catch(() => null)
      : null;
  setAppearance({
    theme: settings.theme,
    accent: resolveAccent(settings.accent, systemAccent),
    diffFontSize: settings.diffFontSize,
  });
  setSidebarWidth(settings.sidebarWidth);
  rememberLaunchLanguage(settings.language);
  await i18n.changeLanguage(resolveLanguage(settings.language));

  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

void start();

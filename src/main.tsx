import React from "react";
import ReactDOM from "react-dom/client";

import i18n, { resolveLanguage, takeLegacyLanguage } from "./i18n";
import "./styles/global.css";
import { AboutApp } from "./app/AboutApp";
import { App, queryClient } from "./app/App";
import { SettingsApp } from "./app/SettingsApp";
import { commands, unwrap } from "./ipc";
import { isAboutWindow } from "./features/about/AboutWindow";
import { preloadSettings, settingsKeys } from "./features/settings/api";
import { preloadAppVersion } from "./features/update/api";
import { resolveAccent } from "./features/settings/SettingsEffects";
import { isSettingsWindow } from "./features/settings/SettingsWindow";
import { installContextMenuGuard } from "./lib/contextMenu";
import { installLayerScrollBounce } from "./lib/scrollBounce";
import { setDetailFilesWidth, setSidebarWidth } from "./lib/layout";
import { initTheme, setAppearance } from "./lib/theme";
import { initWindowFocus } from "./lib/windowFocus";
import { initWindowChrome } from "./lib/windowChrome";

/** Loads settings and applies them before the first frame is drawn. */
async function start() {
  initWindowChrome();
  const stopWindowFocus = initWindowFocus();
  import.meta.hot?.dispose(stopWindowFocus);
  initTheme();
  installContextMenuGuard();
  installLayerScrollBounce();

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
  setDetailFilesWidth(settings.detailFilesWidth);
  await i18n.changeLanguage(resolveLanguage(settings.language));
  // The About window is centered around the version line; don't let it
  // arrive after the first frame and push everything up.
  if (isAboutWindow()) await preloadAppVersion(queryClient);

  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>{root()}</React.StrictMode>,
  );
}

/** What this window shows, by its label. */
function root() {
  if (isSettingsWindow()) return <SettingsApp />;
  if (isAboutWindow()) return <AboutApp />;
  return <App />;
}

void start();

import { getCurrentWindow } from "@tauri-apps/api/window";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useTranslation } from "react-i18next";

import iconUrl from "../../../src-tauri/icons/128x128@2x.png";
import { Button } from "../../components/ui/Button";
import { commands, unwrap } from "../../ipc";
import { useCommand } from "../../lib/commands";
import { useNotify } from "../notify/notifyStore";
import { useWindowTitle } from "../settings/SettingsWindow";
import { useAppVersion } from "../update/api";
import styles from "./AboutWindow.module.css";

/** Label of the About window (`window_open_about` in Rust). */
const ABOUT_WINDOW = "about";

const WEBSITE_URL = "https://github.com/jihun-io/garam";
const LICENSE_URL = "https://github.com/jihun-io/garam/blob/main/LICENSE";

/** Whether this page is the About window rather than a repository window. */
export function isAboutWindow(): boolean {
  try {
    return getCurrentWindow().label === ABOUT_WINDOW;
  } catch {
    return false; // Not running inside Tauri (tests, plain browser).
  }
}

/**
 * The About command, in every window: opens or focuses the About window.
 * It replaces the native About item, which does nothing on Windows and
 * Linux without metadata and can't be translated there.
 */
export function AboutCommand() {
  const showError = useNotify((s) => s.showError);
  useCommand("app.about", () => void unwrap(commands.windowOpenAbout()).catch(showError));
  return null;
}

/** The app's name, version and where it comes from, like the macOS About panel. */
export function AboutWindow() {
  const { t } = useTranslation("about");
  const version = useAppVersion();
  const showError = useNotify((s) => s.showError);
  useWindowTitle(t("title"));

  return (
    // The bare background moves the window: on macOS it has no title bar.
    <main className={styles.root} data-tauri-drag-region>
      <img className={styles.icon} src={iconUrl} width={80} height={80} alt="" draggable={false} />
      <h1 className={styles.name}>Garam</h1>
      {version && <p className={styles.version}>{t("version", { version })}</p>}
      <div className={styles.links}>
        <Button icon="openIn" onClick={() => void openUrl(WEBSITE_URL).catch(showError)}>
          {t("website")}
        </Button>
        <Button icon="openIn" onClick={() => void openUrl(LICENSE_URL).catch(showError)}>
          {t("license")}
        </Button>
      </div>
      <p className={styles.copyright}>{t("copyright")}</p>
    </main>
  );
}

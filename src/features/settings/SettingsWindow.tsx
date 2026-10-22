import { getCurrentWindow } from "@tauri-apps/api/window";
import { Tabs } from "radix-ui";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";

import { focusTabWithoutRing } from "../../components/ui/tabs";
import { commands, unwrap } from "../../ipc";
import { useCommand } from "../../lib/commands";
import { AccountsSettings } from "../accounts/AccountsSettings";
import { useNotify } from "../notify/notifyStore";
import { AppearanceSettings } from "./AppearanceSettings";
import { AppsSettings, SyncSettings } from "./AppsAndSyncSettings";
import { GitSettings } from "./GitSettings";
import { GeneralSettings } from "./GeneralSettings";
import styles from "./Settings.module.css";

/** Label of the settings window (`window_open_settings` in Rust). */
const SETTINGS_WINDOW = "settings";

const SECTIONS = [
  { id: "general", Content: GeneralSettings },
  { id: "appearance", Content: AppearanceSettings },
  { id: "git", Content: GitSettings },
  { id: "accounts", Content: AccountsSettings },
  { id: "apps", Content: AppsSettings },
  { id: "sync", Content: SyncSettings },
] as const;

/** Whether this page is the settings window rather than a repository window. */
export function isSettingsWindow(): boolean {
  try {
    return getCurrentWindow().label === SETTINGS_WINDOW;
  } catch {
    return false; // Not running inside Tauri (tests, plain browser).
  }
}

/** The Settings command, in every window: opens or focuses the settings window. */
export function SettingsCommand() {
  const showError = useNotify((s) => s.showError);
  useCommand("settings", () => void unwrap(commands.windowOpenSettings()).catch(showError));
  return null;
}

/** App settings in their own window: sections on the left, the chosen one on the right. */
export function SettingsWindow() {
  const { t } = useTranslation("settings");
  useWindowTitle(t("title"));

  return (
    <div className={styles.root}>
      {/* The bare header moves the window, like the repository toolbar. */}
      <header className={styles.header} data-tauri-drag-region>
        <h1 className={styles.title} data-tauri-drag-region>
          {t("title")}
        </h1>
      </header>
      <Tabs.Root asChild orientation="vertical" defaultValue="general">
        <main className={styles.body}>
          <Tabs.List className={styles.nav} aria-label={t("sections")}>
            {SECTIONS.map(({ id }) => (
              <Tabs.Trigger
                key={id}
                value={id}
                className={styles.navItem}
                onMouseDown={focusTabWithoutRing}
              >
                {t(`${id}.title`)}
              </Tabs.Trigger>
            ))}
          </Tabs.List>
          {SECTIONS.map(({ id, Content }) => (
            <Tabs.Content key={id} value={id} className={styles.section}>
              <h2 className={styles.sectionTitle}>{t(`${id}.title`)}</h2>
              <Content />
            </Tabs.Content>
          ))}
        </main>
      </Tabs.Root>
    </div>
  );
}

/** Names the window for the Window menu, the Dock and the taskbar. */
function useWindowTitle(title: string) {
  useEffect(() => {
    try {
      void getCurrentWindow()
        .setTitle(title)
        .catch(() => {});
    } catch {
      // Not running inside Tauri.
    }
  }, [title]);
}

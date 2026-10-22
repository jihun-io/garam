import { Dialog, Tabs } from "radix-ui";
import { useTranslation } from "react-i18next";

import { IconButton } from "../../components/ui/IconButton";
import { keepOpenWhenDraggingWindow, WindowDragArea } from "../../components/WindowDragArea";
import { useCommand } from "../../lib/commands";
import { AccountsSettings } from "../accounts/AccountsSettings";
import { AppearanceSettings } from "./AppearanceSettings";
import { AppsSettings, SyncSettings } from "./AppsAndSyncSettings";
import { GitSettings } from "./GitSettings";
import { GeneralSettings } from "./GeneralSettings";
import styles from "./SettingsDialog.module.css";
import { useSettingsDialog } from "./settingsDialogStore";

const SECTIONS = [
  { id: "general", Content: GeneralSettings },
  { id: "appearance", Content: AppearanceSettings },
  { id: "git", Content: GitSettings },
  { id: "accounts", Content: AccountsSettings },
  { id: "apps", Content: AppsSettings },
  { id: "sync", Content: SyncSettings },
] as const;

/** App settings: sections on the left, the chosen section on the right. */
export function SettingsDialog() {
  const { t } = useTranslation("settings");
  const { open, setOpen } = useSettingsDialog();
  useCommand("settings", () => setOpen(true));

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.overlay} />
        <WindowDragArea overDialog />
        <Dialog.Content
          className={styles.content}
          aria-describedby={undefined}
          onPointerDownOutside={keepOpenWhenDraggingWindow}
          onInteractOutside={keepOpenWhenDraggingWindow}
        >
          <header className={styles.header}>
            <Dialog.Title className={styles.title}>{t("title")}</Dialog.Title>
            <Dialog.Close asChild>
              <IconButton icon="close" label={t("close")} size={16} />
            </Dialog.Close>
          </header>
          <Tabs.Root className={styles.body} orientation="vertical" defaultValue="general">
            <Tabs.List className={styles.nav} aria-label={t("sections")}>
              {SECTIONS.map(({ id }) => (
                <Tabs.Trigger key={id} value={id} className={styles.navItem}>
                  {t(`${id}.title`)}
                </Tabs.Trigger>
              ))}
            </Tabs.List>
            {SECTIONS.map(({ id, Content }) => (
              <Tabs.Content key={id} value={id} className={styles.section}>
                <h3 className={styles.sectionTitle}>{t(`${id}.title`)}</h3>
                <Content />
              </Tabs.Content>
            ))}
          </Tabs.Root>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

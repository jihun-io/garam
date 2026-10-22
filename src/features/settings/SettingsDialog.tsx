import { Dialog, Tabs } from "radix-ui";
import { useTranslation } from "react-i18next";

import { IconButton } from "../../components/ui/IconButton";
import { LanguageSelect } from "./LanguageSelect";
import styles from "./SettingsDialog.module.css";
import { useSettingsDialog } from "./settingsDialogStore";

/** App settings: sections on the left, the chosen section on the right. */
export function SettingsDialog() {
  const { t } = useTranslation("settings");
  const { open, setOpen } = useSettingsDialog();

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.overlay} />
        <Dialog.Content className={styles.content} aria-describedby={undefined}>
          <header className={styles.header}>
            <Dialog.Title className={styles.title}>{t("title")}</Dialog.Title>
            <Dialog.Close asChild>
              <IconButton icon="close" label={t("close")} size={16} />
            </Dialog.Close>
          </header>
          <Tabs.Root className={styles.body} orientation="vertical" defaultValue="general">
            <Tabs.List className={styles.nav} aria-label={t("sections")}>
              <Tabs.Trigger value="general" className={styles.navItem}>
                {t("general.title")}
              </Tabs.Trigger>
            </Tabs.List>
            <Tabs.Content value="general" className={styles.section}>
              <h3 className={styles.sectionTitle}>{t("general.title")}</h3>
              <div className={styles.row}>
                <LanguageSelect />
              </div>
            </Tabs.Content>
          </Tabs.Root>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

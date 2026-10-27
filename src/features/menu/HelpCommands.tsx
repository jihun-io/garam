import { openUrl } from "@tauri-apps/plugin-opener";
import { Fragment, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "../../components/ui/Button";
import { FormDialog } from "../../components/ui/Dialog";
import {
  LOCAL_SHORTCUTS,
  SHORTCUTS,
  formatShortcut,
  useCommand,
  type CommandId,
} from "../../lib/commands";
import { useNotify } from "../notify/notifyStore";
import { commandLabel } from "./AppMenu";
import styles from "./HelpCommands.module.css";

const ISSUES_URL = "https://github.com/jihun-io/garam/issues";

/** Help menu commands: the shortcut list and reporting a problem. */
export function HelpCommands() {
  const [showShortcuts, setShowShortcuts] = useState(false);
  const showError = useNotify((s) => s.showError);
  useCommand("help.shortcuts", () => setShowShortcuts(true));
  useCommand("help.report", () => void openUrl(ISSUES_URL).catch(showError));
  return showShortcuts ? <ShortcutsDialog onClose={() => setShowShortcuts(false)} /> : null;
}

function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation(["menu", "repos", "common"]);
  const rows: [string, string][] = [
    ...(Object.entries(SHORTCUTS) as [CommandId, string | null][])
      .filter((entry): entry is [CommandId, string] => entry[1] !== null)
      .map(([id, accelerator]): [string, string] => [commandLabel(t, id), accelerator]),
    [t("menu:shortcuts.commit"), LOCAL_SHORTCUTS.commit],
    [t("menu:shortcuts.discard"), LOCAL_SHORTCUTS.discard],
    [t("menu:shortcuts.selectAllFiles"), LOCAL_SHORTCUTS.selectAllFiles],
  ];

  return (
    <FormDialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={t("menu:shortcuts.title")}
      onSubmit={onClose}
      footer={
        <Button type="submit" variant="primary" autoFocus>
          {t("menu:shortcuts.close")}
        </Button>
      }
    >
      <dl className={styles.list}>
        {rows.map(([label, accelerator]) => (
          <Fragment key={label}>
            <dt>{label.replace(/…$/, "")}</dt>
            <dd>
              <kbd className={styles.kbd}>{formatShortcut(accelerator)}</kbd>
            </dd>
          </Fragment>
        ))}
      </dl>
    </FormDialog>
  );
}

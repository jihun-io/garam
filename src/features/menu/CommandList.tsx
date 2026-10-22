import { useTranslation } from "react-i18next";

import { Icon } from "../../components/Icon";
import type { IconName } from "../../components/icons";
import {
  isCommandEnabled,
  runCommand,
  shortcutFor,
  useCommandsVersion,
  type CommandId,
} from "../../lib/commands";
import { commandLabel } from "./AppMenu";
import styles from "./CommandList.module.css";

const ICONS: Partial<Record<CommandId, IconName>> = {
  "repo.openEditor": "editor",
  "repo.openTerminal": "terminal",
  "repo.reveal": "repository",
};

/**
 * Suggested next steps as buttons, each with its menu label and shortcut so
 * the shortcut is learned along the way. Unavailable commands are hidden.
 */
export function CommandList({ ids }: { ids: CommandId[] }) {
  const { t } = useTranslation(["menu", "repos"]);
  useCommandsVersion();
  const available = ids.filter(isCommandEnabled);
  if (available.length === 0) return null;

  return (
    <ul className={styles.list}>
      {available.map((id) => {
        const shortcut = shortcutFor(id);
        const icon = ICONS[id];
        return (
          <li key={id}>
            <button type="button" className={styles.item} onClick={() => runCommand(id)}>
              {icon && <Icon name={icon} className={styles.icon} />}
              <span className={styles.label}>{commandLabel(t, id)}</span>
              {shortcut && <kbd className={styles.shortcut}>{shortcut}</kbd>}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

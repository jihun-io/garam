import type { ReactNode } from "react";
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
  "branch.createPullRequest": "pullRequest",
};

/**
 * Suggested next steps as buttons, each with its menu label and shortcut so
 * the shortcut is learned along the way. Unavailable commands are hidden.
 * `labels` overrides a menu label where the button can be more specific;
 * `more` joins a square button to a command's, for its variations.
 */
export function CommandList({
  ids,
  labels = {},
  more = {},
}: {
  ids: CommandId[];
  labels?: Partial<Record<CommandId, string>>;
  more?: Partial<Record<CommandId, (className: string) => ReactNode>>;
}) {
  const { t } = useTranslation(["menu", "repos", "common"]);
  useCommandsVersion();
  const available = ids.filter(isCommandEnabled);
  if (available.length === 0) return null;

  return (
    <ul className={styles.list}>
      {available.map((id) => {
        const shortcut = shortcutFor(id);
        const icon = ICONS[id];
        return (
          <li key={id} className={styles.row}>
            <button type="button" className={styles.item} onClick={() => runCommand(id)}>
              {icon && <Icon name={icon} className={styles.icon} />}
              <span className={styles.label}>{labels[id] ?? commandLabel(t, id)}</span>
              {shortcut && <kbd className={styles.shortcut}>{shortcut}</kbd>}
            </button>
            {more[id]?.(styles.more)}
          </li>
        );
      })}
    </ul>
  );
}

import { Tabs } from "radix-ui";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { shortcutFor, useCommand } from "../../lib/commands";
import segmented from "../../components/ui/Segmented.module.css";
import { Tooltip } from "../../components/ui/Tooltip";

import { ChangesView } from "../changes/ChangesView";
import { HistoryView } from "../history/HistoryView";
import styles from "./RepoTabs.module.css";

type View = "changes" | "history";

/** Switches the repository area between local changes and history. */
export function RepoTabs({ repo }: { repo: string }) {
  const { t } = useTranslation("history");
  const [view, setView] = useState<View>("changes");
  useCommand("view.changes", () => setView("changes"));
  useCommand("view.history", () => setView("history"));

  const list = (
    <div className={styles.bar}>
      <Tabs.List className={`${segmented.track} ${styles.list}`} aria-label={t("tabs.label")}>
        <Tooltip content={t("tabs.changes")} shortcut={shortcutFor("view.changes")}>
          <Tabs.Trigger value="changes" className={segmented.segment}>
            {t("tabs.changes")}
          </Tabs.Trigger>
        </Tooltip>
        <Tooltip content={t("tabs.history")} shortcut={shortcutFor("view.history")}>
          <Tabs.Trigger value="history" className={segmented.segment}>
            {t("tabs.history")}
          </Tabs.Trigger>
        </Tooltip>
      </Tabs.List>
    </div>
  );

  return (
    <Tabs.Root
      value={view}
      onValueChange={(v) => setView(v as View)}
      className={styles.root}
      activationMode="manual"
    >
      {/* The panels hold their own controls; they aren't stops themselves. */}
      <Tabs.Content value="changes" className={styles.content} tabIndex={-1}>
        <ChangesView repo={repo} tabs={list} />
      </Tabs.Content>
      <Tabs.Content value="history" className={styles.content} tabIndex={-1}>
        <HistoryView repo={repo} tabs={list} />
      </Tabs.Content>
    </Tabs.Root>
  );
}

import { useQueryClient } from "@tanstack/react-query";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Fragment, useEffect } from "react";
import { useTranslation } from "react-i18next";

import type { RepositoryEntry } from "../../ipc";
import { appNameKey, isDevelopmentApp } from "../../lib/appIdentity";
import { useCommand } from "../../lib/commands";
import { BranchControls } from "../branches/BranchControls";
import { useRepoWatcher } from "../changes/useRepoWatcher";
import { useConflictNoticeCleanup } from "../conflicts/useConflictNoticeCleanup";
import { useHistoryPrepare } from "../history/api";
import { SyncButton } from "../sync/SyncButton";
import { OpenInMenu } from "./OpenInMenu";
import { RepoPicker } from "./RepoPicker";
import { RepositoryOverview } from "./RepositoryOverview";
import { RepoTabs } from "./RepoTabs";
import styles from "./Workspace.module.css";

/** Main window once at least one repository exists. */
export function Workspace({
  repositories,
  selected,
}: {
  repositories: RepositoryEntry[];
  selected: RepositoryEntry | null;
}) {
  const { t } = useTranslation();
  const active = selected && !selected.missing ? selected.path : null;
  useRepoWatcher(active);
  useConflictNoticeCleanup(active);
  useHistoryPrepare(active);
  useWindowTitle(selected?.name ?? null);
  const client = useQueryClient();
  useCommand(
    "view.refresh",
    () => {
      void client.invalidateQueries({ queryKey: ["repo", active] });
      void client.invalidateQueries({ queryKey: ["history", active] });
    },
    active !== null,
  );

  return (
    <div className={styles.root}>
      {/* The bare toolbar (and spacer) moves the window; buttons don't. */}
      <header className={styles.toolbar} data-tauri-drag-region>
        <RepoPicker repositories={repositories} selected={selected} />
        {/* Keyed together so both remount when the repository changes. */}
        {active && (
          <Fragment key={active}>
            <BranchControls repo={active} />
            <SyncButton repo={active} />
          </Fragment>
        )}
        <div className={styles.spacer} data-tauri-drag-region />
        <div className={styles.actions}>
          {selected && <OpenInMenu path={selected.path} disabled={selected.missing} />}
        </div>
      </header>
      <main className={styles.main}>
        {/* For screen reader heading navigation; the toolbar shows the name. */}
        <h1 className="sr-only">{selected?.name ?? t(appNameKey)}</h1>
        {selected &&
          (selected.missing ? (
            <RepositoryOverview key={selected.path} repository={selected} />
          ) : (
            <RepoTabs key={selected.path} repo={selected.path} />
          ))}
      </main>
    </div>
  );
}

/** Names the window after its repository, for the Window menu and Dock. */
function useWindowTitle(name: string | null) {
  const { t } = useTranslation("common");
  const appName = t(appNameKey);
  useEffect(() => {
    try {
      void getCurrentWindow()
        .setTitle(
          name
            ? isDevelopmentApp
              ? t("windowTitleDev", { repository: name, appName })
              : name
            : appName,
        )
        .catch(() => {});
    } catch {
      // Not running inside Tauri.
    }
  }, [name, appName, t]);
}

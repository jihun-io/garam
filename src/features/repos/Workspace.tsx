import { Fragment } from "react";
import { useTranslation } from "react-i18next";

import type { RepositoryEntry } from "../../ipc";
import { BranchControls } from "../branches/BranchControls";
import { useRepoWatcher } from "../changes/useRepoWatcher";
import { IconButton } from "../../components/ui/IconButton";
import { useSettingsDialog } from "../settings/settingsDialogStore";
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
  const { t } = useTranslation("settings");
  const openSettings = useSettingsDialog((s) => s.setOpen);
  const active = selected && !selected.missing ? selected.path : null;
  useRepoWatcher(active);

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
          <IconButton icon="settings" label={t("open")} onClick={() => openSettings(true)} />
        </div>
      </header>
      <main className={styles.main}>
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

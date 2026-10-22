import { Fragment } from "react";

import type { RepositoryEntry } from "../../ipc";
import { BranchControls } from "../branches/BranchControls";
import { ChangesView } from "../changes/ChangesView";
import { useRepoWatcher } from "../changes/useRepoWatcher";
import { LanguageSelect } from "../settings/LanguageSelect";
import { SyncButton } from "../sync/SyncButton";
import { OpenInMenu } from "./OpenInMenu";
import { RepoPicker } from "./RepoPicker";
import { RepositoryOverview } from "./RepositoryOverview";
import styles from "./Workspace.module.css";

/** Main window once at least one repository exists. */
export function Workspace({
  repositories,
  selected,
}: {
  repositories: RepositoryEntry[];
  selected: RepositoryEntry | null;
}) {
  const active = selected && !selected.missing ? selected.path : null;
  useRepoWatcher(active);

  return (
    <div className={styles.root}>
      <header className={styles.toolbar}>
        <RepoPicker repositories={repositories} selected={selected} />
        {/* Keyed together so both remount when the repository changes. */}
        {active && (
          <Fragment key={active}>
            <BranchControls repo={active} />
            <SyncButton repo={active} />
          </Fragment>
        )}
        <div className={styles.spacer} />
        {selected && <OpenInMenu path={selected.path} disabled={selected.missing} />}
        <LanguageSelect />
      </header>
      <main className={styles.main}>
        {selected &&
          (selected.missing ? (
            <RepositoryOverview key={selected.path} repository={selected} />
          ) : (
            <ChangesView key={selected.path} repo={selected.path} />
          ))}
      </main>
    </div>
  );
}

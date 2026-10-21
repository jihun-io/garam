import type { RepositoryEntry } from "../../ipc";
import { LanguageSelect } from "../settings/LanguageSelect";
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
  return (
    <div className={styles.root}>
      <header className={styles.toolbar}>
        <RepoPicker repositories={repositories} selected={selected} />
        <div className={styles.spacer} />
        {selected && <OpenInMenu path={selected.path} disabled={selected.missing} />}
        <LanguageSelect />
      </header>
      <main className={styles.main}>
        {selected && <RepositoryOverview key={selected.path} repository={selected} />}
      </main>
    </div>
  );
}

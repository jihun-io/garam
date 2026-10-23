import { useTranslation } from "react-i18next";

import { ErrorMessage } from "../../components/ErrorMessage";
import { Button } from "../../components/ui/Button";
import { Loading } from "../../components/ui/Loading";
import { toAppError, type CommitSummary } from "../../ipc";
import { shortHash } from "../../lib/hash";
import diffStyles from "../changes/DiffView.module.css";
import { useComparison } from "./api";
import type { CommitActions } from "./CommitList";
import { ChangedFiles } from "./CommitDetailView";
import { CommitTitle } from "./CommitTitle";
import styles from "./History.module.css";

/** Commits listed before "and N more". */
const SHOWN_COMMITS = 5;

/**
 * Several selected commits: what they changed together, and what can be
 * done with all of them.
 */
export function MultiSelectionView({
  repo,
  commits,
  actions,
  onClear,
}: {
  repo: string;
  /** Newest first. */
  commits: CommitSummary[];
  actions: CommitActions["many"];
  onClear: () => void;
}) {
  const { t } = useTranslation("history");
  const newest = commits[0];
  const oldest = commits[commits.length - 1];
  // From just before the oldest; a root commit has nothing before it.
  const from = oldest.parents[0] ?? oldest.oid;
  const comparison = useComparison(repo, from, newest.oid, "two_dot");
  const can = actions.available(commits);
  const shown = commits.slice(0, SHOWN_COMMITS);

  let files;
  if (comparison.isError) {
    files = (
      <div className={diffStyles.noticeBox}>
        <ErrorMessage error={toAppError(comparison.error)} />
      </div>
    );
  } else if (!comparison.data) {
    files = <Loading />;
  } else {
    files = (
      <ChangedFiles
        key={`${comparison.data.from}..${comparison.data.target}`}
        repo={repo}
        files={comparison.data.files}
        source={{ kind: "compare", from: comparison.data.from, target: comparison.data.target }}
      />
    );
  }

  return (
    <div className={`${styles.detail} ${styles.compare}`}>
      <header className={styles.commitHeader}>
        <h2 className={styles.commitSummary}>{t("multi.title", { count: commits.length })}</h2>
        <p className={styles.commitBody}>{t("multi.body")}</p>
        <div className={styles.multiActions}>
          {can.cherryPick && (
            <Button icon="cherryPick" onClick={() => actions.cherryPick(commits)}>
              {t("multi.cherryPick")}
            </Button>
          )}
          <Button icon="cherryPick" onClick={() => actions.cherryPickOnto(commits)}>
            {t("multi.cherryPickOnto")}
          </Button>
          {can.revert && (
            <Button icon="revert" onClick={() => actions.revert(commits)}>
              {t("multi.revert")}
            </Button>
          )}
          {can.squash && (
            <Button icon="squash" onClick={() => actions.squash(commits)}>
              {t("multi.squash")}
            </Button>
          )}
          <Button variant="ghost" onClick={onClear}>
            {t("multi.clear")}
          </Button>
        </div>
      </header>
      <div className={styles.compareSummary}>
        <ul className={styles.compareCommits}>
          {shown.map((commit) => (
            <li key={commit.oid}>
              <span className={styles.compareHash}>{shortHash(commit.oid)}</span>{" "}
              <CommitTitle summary={commit.summary} />
            </li>
          ))}
          {commits.length > shown.length && (
            <li className={styles.compareMore}>
              {t("compare.more", { count: commits.length - shown.length })}
            </li>
          )}
        </ul>
      </div>
      {files}
    </div>
  );
}

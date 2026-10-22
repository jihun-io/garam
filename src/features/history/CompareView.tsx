import { useTranslation } from "react-i18next";

import { ErrorMessage } from "../../components/ErrorMessage";
import { IconButton } from "../../components/ui/IconButton";
import { Loading } from "../../components/ui/Loading";
import { toAppError } from "../../ipc";
import { shortHash } from "../../lib/hash";
import diffStyles from "../changes/DiffView.module.css";
import { useComparison } from "./api";
import { ChangedFiles } from "./CommitDetailView";
import { CommitTitle } from "./CommitTitle";
import styles from "./History.module.css";
import type { HistoryPane } from "./historyPaneStore";

/** Commits listed in the header before "and N more". */
const SHOWN_COMMITS = 5;

/** What changed between two commits or branches. */
export function CompareView({
  repo,
  pane,
  onClose,
}: {
  repo: string;
  pane: Extract<HistoryPane, { kind: "compare" }>;
  onClose: () => void;
}) {
  const { t } = useTranslation("history");
  const comparison = useComparison(repo, pane.base, pane.target, pane.mode);
  const labels = { base: pane.baseLabel, target: pane.targetLabel };

  let body;
  if (comparison.isError) {
    body = (
      <div className={diffStyles.noticeBox}>
        <ErrorMessage error={toAppError(comparison.error)} />
      </div>
    );
  } else if (!comparison.data) {
    body = <Loading />;
  } else {
    const data = comparison.data;
    const shown = data.commits.slice(0, SHOWN_COMMITS);
    body = (
      <>
        <div className={styles.compareSummary}>
          <p className={styles.commitMeta}>
            <span>{t("compare.ahead", { count: data.ahead, ...labels })}</span>
            <span>{t("compare.behind", { count: data.behind, ...labels })}</span>
          </p>
          {shown.length > 0 && (
            <ul className={styles.compareCommits}>
              {shown.map((commit) => (
                <li key={commit.oid}>
                  <span className={styles.compareHash}>{shortHash(commit.oid)}</span>{" "}
                  <CommitTitle summary={commit.summary} />
                </li>
              ))}
              {data.ahead > shown.length && (
                <li className={styles.compareMore}>
                  {t("compare.more", { count: data.ahead - shown.length })}
                </li>
              )}
            </ul>
          )}
        </div>
        <ChangedFiles
          key={`${data.from}..${data.target}`}
          repo={repo}
          files={data.files}
          source={{ kind: "compare", from: data.from, target: data.target }}
        />
      </>
    );
  }

  return (
    <div className={`${styles.detail} ${styles.compare}`}>
      <header className={styles.commitHeader}>
        <div className={styles.compareTitle}>
          <h2 className={styles.commitSummary}>{t("compare.title", labels)}</h2>
          <IconButton icon="close" size={16} label={t("compare.close")} onClick={onClose} />
        </div>
        <p className={styles.commitBody}>
          {t(pane.mode === "three_dot" ? "compare.threeDot" : "compare.twoDot", labels)}
        </p>
      </header>
      {body}
    </div>
  );
}

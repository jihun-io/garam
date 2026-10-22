import { RadioGroup } from "radix-ui";
import { useTranslation } from "react-i18next";

import { ErrorMessage } from "../../components/ErrorMessage";
import { Icon } from "../../components/Icon";
import { Button } from "../../components/ui/Button";
import { IconButton } from "../../components/ui/IconButton";
import segmented from "../../components/ui/Segmented.module.css";
import { Loading } from "../../components/ui/Loading";
import { toAppError, type CompareMode } from "../../ipc";
import { shortHash } from "../../lib/hash";
import diffStyles from "../changes/DiffView.module.css";
import { useComparison } from "./api";
import { ChangedFiles } from "./CommitDetailView";
import { CommitTitle } from "./CommitTitle";
import styles from "./History.module.css";
import type { HistoryPane } from "./historyPaneStore";

type ComparePane = Extract<HistoryPane, { kind: "compare" }>;

/** Commits listed in the header before "and N more". */
const SHOWN_COMMITS = 5;

/** What changed between two commits or branches. */
export function CompareView({
  repo,
  pane,
  onChange,
  onClose,
}: {
  repo: string;
  pane: ComparePane;
  /** Swapping sides or switching the mode shows a new comparison. */
  onChange: (pane: ComparePane) => void;
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
        <div className={styles.multiActions}>
          <CompareModeSwitch value={pane.mode} onChange={(mode) => onChange({ ...pane, mode })} />
          <Button
            onClick={() =>
              onChange({
                ...pane,
                base: pane.target,
                target: pane.base,
                baseLabel: pane.targetLabel,
                targetLabel: pane.baseLabel,
              })
            }
          >
            <Icon name="swap" size={14} />
            {t("compare.swap")}
          </Button>
        </div>
      </header>
      {body}
    </div>
  );
}

/**
 * Two-dot or three-dot comparison, as a segmented control: what changed
 * between the two ends, or only what the target changed since they split.
 */
export function CompareModeSwitch({
  value,
  onChange,
}: {
  value: CompareMode;
  onChange: (mode: CompareMode) => void;
}) {
  const { t } = useTranslation("history");
  return (
    <RadioGroup.Root
      className={segmented.track}
      aria-label={t("compare.mode")}
      value={value}
      onValueChange={(mode) => onChange(mode as CompareMode)}
    >
      <RadioGroup.Item value="three_dot" className={segmented.segment}>
        {t("compare.threeDotShort")}
      </RadioGroup.Item>
      <RadioGroup.Item value="two_dot" className={segmented.segment}>
        {t("compare.twoDotShort")}
      </RadioGroup.Item>
    </RadioGroup.Root>
  );
}

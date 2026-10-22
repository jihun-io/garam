import { useTranslation } from "react-i18next";

import { Icon } from "../../components/Icon";
import styles from "./CommitCounts.module.css";
import { Tooltip } from "../../components/ui/Tooltip";

/** Commits to pull (behind) and to push (ahead), shown only when non-zero. */
export function CommitCounts({ ahead, behind }: { ahead: number; behind: number }) {
  const { t } = useTranslation("branches");
  if (ahead === 0 && behind === 0) return null;
  const labels = [
    behind > 0 ? t("picker.behind", { count: behind }) : null,
    ahead > 0 ? t("picker.ahead", { count: ahead }) : null,
  ];
  const count = (n: number, icon: "pull" | "push", label: string) => (
    <Tooltip content={label}>
      <span className={styles.count} aria-hidden="true">
        <Icon name={icon} size={12} />
        {n}
      </span>
    </Tooltip>
  );
  return (
    <span className={styles.counts}>
      {/* One phrase for screen readers, so the counts don't run together. */}
      <span className="sr-only">{labels.filter(Boolean).join(", ")}</span>
      {labels[0] && count(behind, "pull", labels[0])}
      {labels[1] && count(ahead, "push", labels[1])}
    </span>
  );
}

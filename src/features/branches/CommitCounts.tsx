import { useTranslation } from "react-i18next";

import { Icon } from "../../components/Icon";
import styles from "./CommitCounts.module.css";
import { Tooltip } from "../../components/ui/Tooltip";

/** Commits to pull (behind) and to push (ahead), shown only when non-zero. */
export function CommitCounts({ ahead, behind }: { ahead: number; behind: number }) {
  const { t } = useTranslation("branches");
  if (ahead === 0 && behind === 0) return null;
  const count = (n: number, icon: "pull" | "push", label: string) => (
    <Tooltip content={label}>
      <span className={styles.count}>
        <span className="sr-only">{label}</span>
        <span aria-hidden="true">
          <Icon name={icon} size={12} />
          {n}
        </span>
      </span>
    </Tooltip>
  );
  return (
    <span className={styles.counts}>
      {behind > 0 && count(behind, "pull", t("picker.behind", { count: behind }))}
      {ahead > 0 && count(ahead, "push", t("picker.ahead", { count: ahead }))}
    </span>
  );
}

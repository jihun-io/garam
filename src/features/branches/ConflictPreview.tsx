import { useTranslation } from "react-i18next";

import styles from "./branches.module.css";

/** Files shown by name before the rest are counted. */
const SHOWN = 5;

/**
 * The files a merge (or rebase, `estimate`) would leave conflicted, from
 * an in-memory merge. `null` when git can't tell (older than 2.38).
 */
export function ConflictPreview({
  conflicts,
  estimate = false,
}: {
  conflicts: string[] | null;
  estimate?: boolean;
}) {
  const { t } = useTranslation("branches");
  if (conflicts === null) return <p className={styles.hint}>{t("conflicts.unknown")}</p>;
  if (conflicts.length === 0) return <p className={styles.hint}>{t("conflicts.none")}</p>;
  const rest = conflicts.length - SHOWN;
  return (
    <div className={styles.conflicts}>
      <p>{t(estimate ? "conflicts.may" : "conflicts.will", { count: conflicts.length })}</p>
      <ul className={styles.conflictFiles}>
        {conflicts.slice(0, SHOWN).map((path) => (
          <li key={path}>{path}</li>
        ))}
        {rest > 0 && <li className={styles.hint}>{t("conflicts.more", { count: rest })}</li>}
      </ul>
    </div>
  );
}

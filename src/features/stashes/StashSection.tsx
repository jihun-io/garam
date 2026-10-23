import { useTranslation } from "react-i18next";

import { Icon } from "../../components/Icon";
import { Tooltip } from "../../components/ui/Tooltip";
import type { Stash } from "../../ipc";
import { useRelativeTime } from "../../lib/time";
import { stashTitle } from "./api";
import { useStashSection } from "./sectionStore";
import styles from "./Stashes.module.css";

/**
 * Stashes under the changed files, closed by default. Hidden when there
 * are none.
 */
export function StashSection({
  stashes,
  selected,
  onSelect,
}: {
  stashes: Stash[];
  selected: string | null;
  onSelect: (oid: string) => void;
}) {
  const { t } = useTranslation("stashes");
  const relativeTime = useRelativeTime();
  const { open, toggle } = useStashSection();
  if (stashes.length === 0) return null;

  return (
    <section className={styles.section}>
      <button type="button" className={styles.header} aria-expanded={open} onClick={toggle}>
        <Icon name="disclosure" size={12} className={styles.disclosure} />
        <Icon name="stash" size={14} />
        <span className={styles.headerTitle}>{t("section.title")}</span>
        <span className={styles.count}>{t("section.count", { count: stashes.length })}</span>
      </button>
      {open && (
        <ul className={styles.list} aria-label={t("section.list")}>
          {stashes.map((stash) => {
            const title = stashTitle(t, stash);
            return (
              <li key={stash.oid}>
                <button
                  type="button"
                  className={styles.row}
                  aria-current={stash.oid === selected ? "true" : undefined}
                  onClick={() => onSelect(stash.oid)}
                >
                  <Tooltip content={title} whenTruncated>
                    <span className={styles.rowTitle}>{title}</span>
                  </Tooltip>
                  <span className={styles.rowTime}>{relativeTime(stash.createdAt)}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

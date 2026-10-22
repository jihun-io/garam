import { parseConventional } from "./message";
import styles from "./History.module.css";

/**
 * A commit summary with its Conventional Commits prefix (`fix(ui):`) drawn
 * as a badge. Other summaries are shown as they are.
 */
export function CommitTitle({ summary }: { summary: string }) {
  const parsed = parseConventional(summary);
  if (!parsed) return <>{summary}</>;
  const prefix = parsed.scope ? `${parsed.type}(${parsed.scope})` : parsed.type;
  return (
    <>
      <span className={styles.typeBadge}>
        {prefix}
        {parsed.breaking && "!"}
      </span>{" "}
      {parsed.subject}
    </>
  );
}

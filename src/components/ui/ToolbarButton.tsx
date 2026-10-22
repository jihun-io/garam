import type { ButtonHTMLAttributes, ReactNode } from "react";

import { Icon } from "../Icon";
import type { IconName } from "../icons";
import styles from "./ToolbarButton.module.css";

/**
 * A toolbar button with an icon and two lines of text (docs/UI.md 3):
 * pickers show a small caption above the value ("Current branch" / "main"),
 * actions show the value above a detail line ("Push origin" / "5 min ago").
 */
export function ToolbarButton({
  icon,
  caption,
  value,
  captionBelow = false,
  trailing,
  progress,
  className,
  ...button
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  icon: IconName;
  caption: ReactNode;
  value: ReactNode;
  captionBelow?: boolean;
  /** Shown after the text, e.g. a dropdown caret or commit counts. */
  trailing?: ReactNode;
  /** 0–100 fills the button as a progress bar; `undefined` hides it. */
  progress?: number;
}) {
  const captionEl = <span className={styles.caption}>{caption}</span>;
  const valueEl = <span className={styles.value}>{value}</span>;
  return (
    <button
      type="button"
      className={[styles.button, className].filter(Boolean).join(" ")}
      {...button}
    >
      {progress !== undefined && (
        <span className={styles.fill} style={{ width: `${progress}%` }} aria-hidden="true" />
      )}
      <Icon name={icon} size={20} className={styles.icon} />
      <span className={styles.text}>
        {captionBelow ? (
          <>
            {valueEl}
            {captionEl}
          </>
        ) : (
          <>
            {captionEl}
            {valueEl}
          </>
        )}
      </span>
      {trailing}
    </button>
  );
}

/**
 * Holds a toolbar button's place while its data loads, so the toolbar
 * doesn't shift when it arrives.
 */
export function ToolbarPlaceholder({ icon, className }: { icon: IconName; className?: string }) {
  return (
    <div
      className={[styles.button, styles.placeholder, className].filter(Boolean).join(" ")}
      aria-hidden="true"
    >
      <Icon name={icon} size={20} className={styles.icon} />
      <span className={styles.text}>
        <span className={styles.bar} />
        <span className={`${styles.bar} ${styles.barShort}`} />
      </span>
    </div>
  );
}

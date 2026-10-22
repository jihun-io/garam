import type { ReactNode } from "react";

import { Icon } from "./Icon";
import type { IconName } from "./icons";
import styles from "./EmptyMessage.module.css";

/** Centered message for an empty area, with optional next steps below. */
export function EmptyMessage({
  icon,
  title,
  body,
  children,
}: {
  icon: IconName;
  title: string;
  body?: string;
  children?: ReactNode;
}) {
  return (
    <div className={styles.root}>
      <Icon name={icon} size={32} className={styles.icon} />
      <h2 className={styles.title}>{title}</h2>
      {body && <p className={styles.body}>{body}</p>}
      {children}
    </div>
  );
}

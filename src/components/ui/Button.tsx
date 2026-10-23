import type { ButtonHTMLAttributes } from "react";

import { Icon } from "../Icon";
import type { IconName } from "../icons";
import styles from "./Button.module.css";

type Variant = "primary" | "secondary" | "ghost" | "danger";

/**
 * A push button. `icon` leads the label on buttons that start an action
 * (push, stash, merge…); dialog answers like Cancel and OK stay text only
 * (docs/UI.md 4.2).
 */
export function Button({
  variant = "secondary",
  icon,
  className,
  type = "button",
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; icon?: IconName }) {
  return (
    <button
      type={type}
      className={[styles.button, styles[variant], className].filter(Boolean).join(" ")}
      {...props}
    >
      {icon && <Icon name={icon} size={14} />}
      {children}
    </button>
  );
}

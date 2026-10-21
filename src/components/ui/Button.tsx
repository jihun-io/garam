import type { ButtonHTMLAttributes } from "react";

import styles from "./Button.module.css";

type Variant = "primary" | "secondary" | "ghost";

export function Button({
  variant = "secondary",
  className,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      type={type}
      className={[styles.button, styles[variant], className].filter(Boolean).join(" ")}
      {...props}
    />
  );
}

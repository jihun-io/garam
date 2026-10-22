import type { ButtonHTMLAttributes } from "react";

import { Icon, type IconSize } from "../Icon";
import type { IconName } from "../icons";
import styles from "./IconButton.module.css";
import { Tooltip } from "./Tooltip";

/** A button showing only an icon; `label` names it and is its tooltip. */
export function IconButton({
  icon,
  label,
  size = 20,
  className,
  ...button
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  icon: IconName;
  label: string;
  size?: IconSize;
}) {
  return (
    <Tooltip content={label}>
      <button
        type="button"
        aria-label={label}
        className={[styles.button, className].filter(Boolean).join(" ")}
        {...button}
      >
        <Icon name={icon} size={size} />
      </button>
    </Tooltip>
  );
}

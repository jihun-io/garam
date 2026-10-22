import { Icons, type IconName } from "./icons";
import styles from "./Icon.module.css";

export type IconSize = 12 | 14 | 16 | 20;

/**
 * An icon from the app's set. Decorative by default; pass `label` when the
 * icon alone carries meaning. `filled` marks selected or active states.
 */
export function Icon({
  name,
  size = 16,
  filled = false,
  label,
  className,
}: {
  name: IconName;
  size?: IconSize;
  filled?: boolean;
  label?: string;
  className?: string;
}) {
  const Glyph = Icons[name];
  return (
    <Glyph
      size={size}
      weight={filled ? "fill" : "regular"}
      className={[styles.icon, className].filter(Boolean).join(" ")}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? "img" : undefined}
      focusable="false"
    />
  );
}

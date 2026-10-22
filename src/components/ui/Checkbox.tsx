import { useEffect, useRef, type InputHTMLAttributes } from "react";

import styles from "./Checkbox.module.css";

/** Native checkbox with a third, "mixed" state. */
export function Checkbox({
  state,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "checked"> & {
  state: "checked" | "unchecked" | "mixed";
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = state === "mixed";
  }, [state]);
  return (
    <input
      ref={ref}
      type="checkbox"
      className={styles.checkbox}
      checked={state === "checked"}
      aria-checked={state === "mixed" ? "mixed" : state === "checked"}
      {...props}
    />
  );
}

/**
 * Looks like a checkbox but is only a picture of one, for rows that report
 * the state themselves (e.g. a list option with `aria-checked`): a real
 * input there would be a control nested in a control.
 */
export function CheckMark({
  state,
  disabled = false,
  onToggle,
}: {
  state: "checked" | "unchecked" | "mixed";
  disabled?: boolean;
  onToggle: () => void;
}) {
  return (
    <span
      className={styles.checkbox}
      data-checkmark
      data-state={state}
      data-disabled={disabled || undefined}
      aria-hidden="true"
      // Clicking the box toggles without also selecting the row.
      onMouseDown={(e) => e.stopPropagation()}
      onClick={() => !disabled && onToggle()}
    />
  );
}

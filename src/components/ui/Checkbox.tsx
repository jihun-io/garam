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

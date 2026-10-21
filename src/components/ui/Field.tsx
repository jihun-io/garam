import { useId, type InputHTMLAttributes, type ReactNode } from "react";

import styles from "./Field.module.css";

/** A labelled text input with an optional hint and trailing control. */
export function Field({
  label,
  hint,
  trailing,
  ...input
}: InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  hint?: ReactNode;
  trailing?: ReactNode;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  return (
    <div className={styles.field}>
      <label htmlFor={id} className={styles.label}>
        {label}
      </label>
      <div className={styles.row}>
        <input
          id={id}
          className={styles.input}
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
          aria-describedby={hint ? hintId : undefined}
          {...input}
        />
        {trailing}
      </div>
      {hint && (
        <p id={hintId} className={styles.hint}>
          {hint}
        </p>
      )}
    </div>
  );
}

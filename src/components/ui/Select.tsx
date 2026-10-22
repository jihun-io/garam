import { Select as RadixSelect } from "radix-ui";

import { Icon } from "../Icon";
import styles from "./Select.module.css";

export type SelectOption<T extends string> = { value: T; label: string; lang?: string };

/**
 * A dropdown that matches the app instead of the browser's native control.
 * Keyboard works as usual: arrows, typing to jump, Enter, Escape.
 */
export function Select<T extends string>({
  id,
  value,
  options,
  onChange,
  label,
}: {
  /** For a `<label htmlFor>` elsewhere. */
  id?: string;
  value: T;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
  /** Accessible name when there's no visible label. */
  label?: string;
}) {
  return (
    <RadixSelect.Root value={value} onValueChange={(v) => onChange(v as T)}>
      <RadixSelect.Trigger id={id} className={styles.trigger} aria-label={label}>
        <RadixSelect.Value />
        <RadixSelect.Icon className={styles.caret}>
          <Icon name="dropdown" size={12} />
        </RadixSelect.Icon>
      </RadixSelect.Trigger>
      <RadixSelect.Portal>
        <RadixSelect.Content className={styles.content} position="popper" sideOffset={4}>
          <RadixSelect.Viewport className={styles.viewport}>
            {options.map((option) => (
              <RadixSelect.Item
                key={option.value}
                value={option.value}
                className={styles.item}
                lang={option.lang}
              >
                <RadixSelect.ItemIndicator className={styles.check}>
                  <Icon name="check" size={14} />
                </RadixSelect.ItemIndicator>
                <RadixSelect.ItemText>{option.label}</RadixSelect.ItemText>
              </RadixSelect.Item>
            ))}
          </RadixSelect.Viewport>
        </RadixSelect.Content>
      </RadixSelect.Portal>
    </RadixSelect.Root>
  );
}

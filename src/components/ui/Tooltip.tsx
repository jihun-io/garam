import { Tooltip as RadixTooltip } from "radix-ui";
import { useRef, useState, type ReactElement, type ReactNode } from "react";

import styles from "./Tooltip.module.css";

/** Wrap the app once; sets the shared delay (docs/UI.md 4.4). */
export function TooltipProvider({ children }: { children: ReactNode }) {
  return (
    <RadixTooltip.Provider delayDuration={500} skipDelayDuration={300}>
      {children}
    </RadixTooltip.Provider>
  );
}

/**
 * A tooltip for `children`, shown on hover and on keyboard focus. The child
 * must accept a ref (a DOM element or a forwardRef component).
 */
export function Tooltip({
  content,
  shortcut,
  children,
  side = "bottom",
  whenTruncated = false,
}: {
  content: ReactNode;
  /** Already formatted, e.g. from `shortcutFor`. */
  shortcut?: string | null;
  children: ReactElement;
  side?: "top" | "right" | "bottom" | "left";
  /** Show only while the child's text is cut off, to reveal all of it. */
  whenTruncated?: boolean;
}) {
  // Typed as a button for Radix; with `asChild` it is whatever the child is.
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const control = whenTruncated
    ? { open, onOpenChange: (next: boolean) => setOpen(next && isTruncated(ref.current)) }
    : {};
  return (
    <RadixTooltip.Root {...control}>
      <RadixTooltip.Trigger asChild ref={ref}>
        {children}
      </RadixTooltip.Trigger>
      <RadixTooltip.Portal>
        <RadixTooltip.Content className={styles.content} side={side} sideOffset={6}>
          {content}
          {shortcut && <kbd className={styles.shortcut}>{shortcut}</kbd>}
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  );
}

function isTruncated(el: HTMLElement | null): boolean {
  return el !== null && el.scrollWidth > el.clientWidth;
}

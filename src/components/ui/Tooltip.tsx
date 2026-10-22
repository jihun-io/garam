import { Tooltip as RadixTooltip } from "radix-ui";
import type { ReactElement, ReactNode } from "react";

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
  children,
  side = "bottom",
}: {
  content: ReactNode;
  children: ReactElement;
  side?: "top" | "right" | "bottom" | "left";
}) {
  return (
    <RadixTooltip.Root>
      <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
      <RadixTooltip.Portal>
        <RadixTooltip.Content className={styles.content} side={side} sideOffset={6}>
          {content}
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  );
}

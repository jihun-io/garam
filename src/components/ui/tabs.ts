import type { MouseEvent } from "react";

/**
 * For a Radix `Tabs.Trigger`'s `onMouseDown`. Radix focuses the tab from
 * script on mouse down, and WebKit shows the keyboard focus ring for script
 * focus, so a click left a ring behind. Focusing it here first, without the
 * ring, makes Radix's own `focus()` a no-op; it still selects the tab.
 */
export function focusTabWithoutRing(event: MouseEvent<HTMLElement>) {
  if (event.button === 0 && !event.ctrlKey) {
    event.currentTarget.focus({ focusVisible: false });
  }
}

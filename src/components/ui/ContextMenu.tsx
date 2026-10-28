import { isTauri } from "@tauri-apps/api/core";
import { ContextMenu as RadixMenu, Slot } from "radix-ui";
import { useEffect, useRef, type KeyboardEvent, type ReactElement } from "react";

import {
  menuEntries,
  releaseContextMenu,
  showContextMenu,
  type ContextMenuEntry,
} from "../../lib/nativeContextMenu";
import styles from "./Menu.module.css";

export type { ContextMenuEntry } from "../../lib/nativeContextMenu";

/** Open the focused option's menu when focus stays on an ARIA listbox. */
export function openListContextMenu(event: KeyboardEvent, optionId: string | null): boolean {
  if (!isMenuKey(event) || !optionId) return false;
  const option = document.getElementById(optionId);
  if (!option?.hasAttribute("data-context-menu")) return false;
  event.preventDefault();
  event.stopPropagation();
  const bounds = option.getBoundingClientRect();
  option.dispatchEvent(
    new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: bounds.left,
      clientY: bounds.bottom,
    }),
  );
  return true;
}

function isMenuKey(event: KeyboardEvent) {
  return (
    !event.nativeEvent.isComposing &&
    (event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey))
  );
}

/** Native in the desktop app; Radix keeps browser previews usable. */
export function ContextMenu({
  items,
  children,
}: {
  items: ContextMenuEntry[];
  children: ReactElement;
}) {
  const owner = useRef({});
  useEffect(() => {
    const identity = owner.current;
    return () => releaseContextMenu(identity);
  }, []);

  const trigger = (
    <Slot.Root
      data-context-menu=""
      onContextMenu={(event) => {
        if (!isTauri() || event.defaultPrevented || (import.meta.env.DEV && event.altKey)) return;
        event.preventDefault();
        event.stopPropagation();
        const element = event.currentTarget;
        const returnTo = element.closest<HTMLElement>("button, [tabindex='0']") ?? element;
        returnTo.focus({ preventScroll: true });
        showContextMenu(owner.current, items, { x: event.clientX, y: event.clientY }, returnTo);
      }}
      onKeyDown={(event) => {
        if (!isMenuKey(event) || event.defaultPrevented) return;
        event.preventDefault();
        event.stopPropagation();
        const bounds = event.currentTarget.getBoundingClientRect();
        event.currentTarget.dispatchEvent(
          new MouseEvent("contextmenu", {
            bubbles: true,
            cancelable: true,
            clientX: bounds.left,
            clientY: bounds.bottom,
          }),
        );
      }}
    >
      {children}
    </Slot.Root>
  );
  if (isTauri()) return trigger;
  return (
    <RadixMenu.Root>
      <RadixMenu.Trigger asChild>{trigger}</RadixMenu.Trigger>
      <RadixMenu.Portal>
        <RadixMenu.Content className={styles.content}>
          {menuEntries(items).map((item, index) =>
            item === "separator" ? (
              <RadixMenu.Separator key={index} className={styles.separator} />
            ) : (
              <RadixMenu.Item
                key={index}
                className={styles.item}
                disabled={item.disabled}
                onSelect={() => void item.action()}
              >
                {item.label}
              </RadixMenu.Item>
            ),
          )}
        </RadixMenu.Content>
      </RadixMenu.Portal>
    </RadixMenu.Root>
  );
}

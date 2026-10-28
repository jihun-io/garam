import { isTauri } from "@tauri-apps/api/core";
import { DropdownMenu, Slot } from "radix-ui";
import { useEffect, useRef, type ComponentProps, type ReactElement } from "react";

import {
  releaseContextMenu,
  showContextMenu,
  type ContextMenuEntry,
} from "../../lib/nativeContextMenu";
import { MenuItems } from "./MenuItems";
import styles from "./Menu.module.css";

/** A command button opens an OS menu anchored below it; previews use Radix. */
export function MenuButton({
  items,
  children,
  disabled,
  align = "start",
  ...trigger
}: {
  items: ContextMenuEntry[];
  children: ReactElement;
  disabled?: boolean;
  align?: "start" | "end";
} & Omit<ComponentProps<typeof Slot.Root>, "children">) {
  const owner = useRef({});
  useEffect(() => {
    const identity = owner.current;
    return () => releaseContextMenu(identity);
  }, []);

  const show = (button: HTMLElement) => {
    if (disabled) return;
    const bounds = button.getBoundingClientRect();
    showContextMenu(owner.current, items, { x: bounds.left, y: bounds.bottom + 4 }, button);
  };
  if (isTauri())
    return (
      <Slot.Root
        {...trigger}
        {...{ disabled }}
        aria-haspopup="menu"
        onClick={(event) => {
          trigger.onClick?.(event);
          if (event.defaultPrevented) return;
          event.preventDefault();
          show(event.currentTarget);
        }}
        onKeyDown={(event) => {
          trigger.onKeyDown?.(event);
          if (event.defaultPrevented || event.nativeEvent.isComposing) return;
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            event.stopPropagation();
            show(event.currentTarget);
          }
        }}
      >
        {children}
      </Slot.Root>
    );
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild disabled={disabled}>
        <Slot.Root {...trigger}>{children}</Slot.Root>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className={styles.content} align={align} sideOffset={4}>
          <MenuItems items={items} menu={DropdownMenu} />
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

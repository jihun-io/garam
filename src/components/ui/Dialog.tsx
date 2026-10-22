import { Dialog as RadixDialog } from "radix-ui";
import { useState, type FormEvent, type ReactNode } from "react";

import { keepOpenWhenDraggingWindow, WindowDragArea } from "../WindowDragArea";
import styles from "./Dialog.module.css";

// The last element focused outside a menu. A dialog opened from a menu
// item returns focus here: by the time it closes, the item is gone.
let lastFocusOutsideMenus: HTMLElement | null = null;
document.addEventListener("focusin", (e) => {
  if (e.target instanceof HTMLElement && !e.target.closest('[role="menu"]')) {
    lastFocusOutsideMenus = e.target;
  }
});

/**
 * Modal form dialog. The body is wrapped in a <form> so Enter submits;
 * `footer` holds the buttons.
 */
export function FormDialog({
  open,
  onOpenChange,
  title,
  onSubmit,
  children,
  footer,
  dismissible = true,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  onSubmit: () => void;
  children: ReactNode;
  footer: ReactNode;
  /** When false, Escape and outside clicks don't close it (e.g. mid-clone). */
  dismissible?: boolean;
}) {
  // Taken while rendering as it opens, before focus moves into the dialog,
  // and kept through the closing so the close handler can use it.
  const [seen, setSeen] = useState(() => ({ open, returnTo: lastFocusOutsideMenus }));
  if (open !== seen.open) {
    setSeen({ open, returnTo: open ? lastFocusOutsideMenus : seen.returnTo });
  }
  const { returnTo } = seen;
  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit();
  };
  const block = (e: Event) => {
    if (!dismissible) e.preventDefault();
  };
  const outside = (e: Event) => {
    block(e);
    keepOpenWhenDraggingWindow(e);
  };

  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className={styles.overlay} />
        <WindowDragArea overDialog />
        <RadixDialog.Content
          className={styles.content}
          aria-describedby={undefined}
          onEscapeKeyDown={block}
          onPointerDownOutside={outside}
          onInteractOutside={outside}
          onCloseAutoFocus={(e) => {
            if (!returnTo?.isConnected) return;
            e.preventDefault();
            returnTo.focus();
          }}
        >
          <form onSubmit={handleSubmit} className={styles.form}>
            <RadixDialog.Title className={styles.title}>{title}</RadixDialog.Title>
            <div className={styles.body}>{children}</div>
            <div className={styles.footer}>{footer}</div>
          </form>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

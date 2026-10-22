import { Dialog as RadixDialog } from "radix-ui";
import type { FormEvent, ReactNode } from "react";

import { keepOpenWhenDraggingWindow, WindowDragArea } from "../WindowDragArea";
import styles from "./Dialog.module.css";

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

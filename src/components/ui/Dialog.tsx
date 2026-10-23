import { Dialog as RadixDialog } from "radix-ui";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";

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
  description,
  dismissible = true,
  wide = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** A line under the title that stays in place while the body scrolls. */
  description?: ReactNode;
  onSubmit: () => void;
  children: ReactNode;
  footer: ReactNode;
  /** When false, Escape and outside clicks don't close it (e.g. mid-clone). */
  dismissible?: boolean;
  /** A tall, wide sheet for side-by-side content (e.g. a form and a diff). */
  wide?: boolean;
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
    // React bubbles events through the portal to the dialog's React
    // parents, so a dialog opened from inside another form (the commit
    // form's checks) would submit that form too.
    e.stopPropagation();
    onSubmit();
  };
  const block = (e: Event) => {
    if (!dismissible) e.preventDefault();
  };
  const outside = (e: Event) => {
    block(e);
    keepOpenWhenDraggingWindow(e);
  };

  // State, not a ref: the portal mounts the body after this renders.
  const [body, setBody] = useState<HTMLDivElement | null>(null);
  const edges = useScrollEdges(body);
  // The button focused as the dialog opens shows no ring until a key is
  // pressed in the dialog: opening it with a shortcut (⌘/) counts as
  // keyboard use, but the user hasn't moved focus anywhere yet.
  const [quietFocus, setQuietFocus] = useState(true);
  if (!open && !quietFocus) setQuietFocus(true);

  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className={styles.overlay} />
        <WindowDragArea overDialog />
        <RadixDialog.Content
          className={wide ? `${styles.content} ${styles.wide}` : styles.content}
          {...(description ? {} : { "aria-describedby": undefined })}
          onEscapeKeyDown={block}
          onPointerDownOutside={outside}
          onInteractOutside={outside}
          data-quiet-focus={quietFocus || undefined}
          onKeyDownCapture={() => setQuietFocus(false)}
          onOpenAutoFocus={() => {
            // Focusing a footer button can still scroll the body in WebKit;
            // a long body should start at the top unless focus is in it.
            requestAnimationFrame(() => {
              if (body && !body.contains(document.activeElement)) body.scrollTop = 0;
            });
          }}
          onCloseAutoFocus={(e) => {
            if (!returnTo?.isConnected) return;
            e.preventDefault();
            returnTo.focus();
          }}
        >
          <form onSubmit={handleSubmit} className={styles.form}>
            <div className={styles.header} data-more={edges.above || undefined}>
              <RadixDialog.Title className={styles.title}>{title}</RadixDialog.Title>
              {description && (
                <RadixDialog.Description className={styles.description}>
                  {description}
                </RadixDialog.Description>
              )}
            </div>
            <div ref={setBody} className={styles.body}>
              {children}
            </div>
            <div className={styles.footer} data-more={edges.below || undefined}>
              {footer}
            </div>
          </form>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

/**
 * Whether `el` has content scrolled away above it and still to scroll to
 * below it, so a line can mark the cut.
 */
function useScrollEdges(el: HTMLElement | null): { above: boolean; below: boolean } {
  const [edges, setEdges] = useState({ above: false, below: false });
  useEffect(() => {
    if (!el || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      // Below zero while WebKit bounces past the top; a pixel of slack for
      // fractional heights.
      const above = el.scrollTop > 0;
      const below = el.scrollTop + el.clientHeight < el.scrollHeight - 1;
      setEdges((old) => (old.above === above && old.below === below ? old : { above, below }));
    };
    // The body keeps its size once it reaches the height limit, so its
    // content is watched too: rows come and go while the dialog is open.
    const resize = new ResizeObserver(measure);
    resize.observe(el);
    const mutation = new MutationObserver(measure);
    mutation.observe(el, { childList: true, subtree: true, characterData: true });
    el.addEventListener("scroll", measure, { passive: true });
    measure();
    return () => {
      resize.disconnect();
      mutation.disconnect();
      el.removeEventListener("scroll", measure);
    };
  }, [el]);
  return edges;
}

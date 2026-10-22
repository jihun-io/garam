import styles from "./WindowDragArea.module.css";

/**
 * On macOS the title bar is merged into the content, so screens without a
 * toolbar still need a strip at the top to move the window by. The
 * toolbar, where present, sits above this and drags on its own.
 *
 * Modal dialogs cover the toolbar with their backdrop, so they render one
 * with `overDialog`: the height of the toolbar, above the backdrop.
 */
export function WindowDragArea({ overDialog = false }: { overDialog?: boolean }) {
  return (
    <div
      className={`${styles.area} ${overDialog ? styles.overDialog : ""}`}
      data-tauri-drag-region
    />
  );
}

/**
 * For a dialog's `onPointerDownOutside`/`onInteractOutside`: starting to
 * drag the window isn't a click outside, so the dialog stays open.
 */
export function keepOpenWhenDraggingWindow(event: Event) {
  const target = event.target;
  if (target instanceof Element && target.closest("[data-tauri-drag-region]")) {
    event.preventDefault();
  }
}

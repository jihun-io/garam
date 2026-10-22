import styles from "./WindowDragArea.module.css";

/**
 * On macOS the title bar is merged into the content, so screens without a
 * toolbar still need a strip at the top to move the window by. The
 * toolbar, where present, sits above this and drags on its own.
 */
export function WindowDragArea() {
  return <div className={styles.area} data-tauri-drag-region />;
}

/** Sidebar width limits in CSS pixels (see `--sidebar-actual` in tokens.css). */
export const SIDEBAR = {
  default: 320,
  /** Keeps the toolbar's repository button (above the sidebar) at its 160px minimum. */
  min: 256,
  /**
   * Room always left to the right of the sidebar: enough for the diff and
   * for the toolbar's branch and sync buttons at their minimum width.
   */
  minMain: 480,
  max: 560,
};

/** The widest the sidebar may be in the current window. */
export function maxSidebarWidth(): number {
  return Math.max(SIDEBAR.min, Math.min(SIDEBAR.max, window.innerWidth - SIDEBAR.minMain));
}

export function clampSidebarWidth(width: number): number {
  return Math.round(Math.min(maxSidebarWidth(), Math.max(SIDEBAR.min, width)));
}

/** Sets the sidebar width the layout and the toolbar both follow. */
export function setSidebarWidth(width: number) {
  document.documentElement.style.setProperty("--sidebar-width", `${width}px`);
}

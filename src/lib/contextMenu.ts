/**
 * The webview's own context menu (Reload, Inspect Element, …) is a web
 * page's menu, not an app's. It stays only where it does a job: in text
 * fields (cut, copy, paste) and over selected text (copy). Screens with
 * their own menus (ContextMenu) handle the event first.
 */
export function allowsNativeContextMenu(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target.closest("input, textarea, [contenteditable]:not([contenteditable='false'])")) {
    return true;
  }
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return false;
  return selection.getRangeAt(0).intersectsNode(target);
}

/**
 * Hides the native context menu elsewhere. In development, holding Option
 * (Alt) keeps it so the web inspector stays reachable.
 */
export function installContextMenuGuard() {
  document.addEventListener("contextmenu", (e) => {
    if (e.defaultPrevented) return;
    if (import.meta.env.DEV && e.altKey) return;
    if (!allowsNativeContextMenu(e.target)) e.preventDefault();
  });
}

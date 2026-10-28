import { getCurrentWindow } from "@tauri-apps/api/window";

/** Track native window activation and top-level webview focus together. */
export function initWindowFocus(): () => void {
  const root = document.documentElement;
  let nativeFocused = true;
  let webviewFocused = document.hasFocus();
  const update = () => {
    root.dataset.windowFocused = String(nativeFocused && webviewFocused);
  };
  const onWebviewFocus = (event: FocusEvent) => {
    // Control focus changes are not window activation changes.
    if (event.target !== event.currentTarget) return;
    webviewFocused = event.type === "focus";
    update();
  };
  window.addEventListener("focus", onWebviewFocus);
  window.addEventListener("blur", onWebviewFocus);
  const stopWebviewFocus = () => {
    window.removeEventListener("focus", onWebviewFocus);
    window.removeEventListener("blur", onWebviewFocus);
    delete root.dataset.windowFocused;
  };
  update();
  let appWindow;
  try {
    appWindow = getCurrentWindow();
  } catch {
    /* Browser preview. */
  }
  if (!appWindow) return stopWebviewFocus;

  let disposed = false;
  let revision = 0;
  let unlisten: (() => void) | undefined;
  // Subscribe first so a delayed initial snapshot cannot overwrite a newer event.
  void appWindow
    .onFocusChanged(({ payload }) => {
      revision++;
      if (!disposed) {
        nativeFocused = payload;
        update();
      }
    })
    .then(async (stop) => {
      if (disposed) {
        stop();
        return;
      }
      unlisten = stop;
      const before = revision;
      const focused = await appWindow.isFocused();
      if (!disposed && revision === before) {
        nativeFocused = focused;
        update();
      }
    })
    .catch(() => {});
  return () => {
    disposed = true;
    unlisten?.();
    stopWebviewFocus();
  };
}

import { getCurrentWindow } from "@tauri-apps/api/window";

import { currentPlatform } from "./platform";

/**
 * Marks <html> with the platform and, on macOS, whether the window is in
 * full screen. CSS uses these to leave room for the window buttons that sit
 * inside the toolbar (docs/UI.md 4.3).
 */
export function initWindowChrome() {
  const root = document.documentElement;
  root.dataset.platform = currentPlatform();
  if (root.dataset.platform !== "macos") return;

  let window;
  try {
    window = getCurrentWindow();
  } catch {
    return; // Not running inside Tauri (tests, plain browser).
  }
  const update = () =>
    void window
      .isFullscreen()
      .then((fullscreen) => {
        if (fullscreen) root.dataset.fullscreen = "";
        else delete root.dataset.fullscreen;
      })
      .catch(() => {});
  update();
  void window.onResized(update).catch(() => {});
}

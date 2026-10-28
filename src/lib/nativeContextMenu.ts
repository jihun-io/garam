import { Menu } from "@tauri-apps/api/menu";
import { getCurrentWindow } from "@tauri-apps/api/window";

import { commands, unwrap } from "../ipc";

import { useNotify } from "../features/notify/notifyStore";

export type ContextMenuAction = {
  label: string;
  disabled?: boolean;
  action: () => unknown;
};
export type ContextMenuEntry = ContextMenuAction | "separator" | false | null | undefined;

export function menuEntries(entries: ContextMenuEntry[]): (ContextMenuAction | "separator")[] {
  const shown = entries.filter((entry) => !!entry);
  return shown.filter(
    (entry, index) =>
      entry !== "separator" ||
      (index > 0 && index < shown.length - 1 && shown[index - 1] !== "separator"),
  );
}

// One popup per webview. Reusing window-scoped item IDs also replaces Tauri's
// action channels instead of leaving a new channel behind on every right click.
let revision = 0;
let owner: object | null = null;
let current: Menu | null = null;
let pending = Promise.resolve();

async function releaseMenu() {
  const menu = current;
  current = null;
  await menu?.close();
}

export function releaseContextMenu(forOwner: object) {
  if (owner !== forOwner) return;
  owner = null;
  revision++;
  pending = pending.then(releaseMenu).catch(useNotify.getState().showError);
}

export function showContextMenu(
  forOwner: object,
  entries: ContextMenuEntry[],
  position: { x: number; y: number },
  returnTo: HTMLElement,
) {
  const request = ++revision;
  owner = forOwner;
  const shown = menuEntries(entries);
  // Keep creation ordered: an older request must never replace a newer one's
  // action channels, even when IPC finishes after another right click.
  pending = pending
    .then(async () => {
      await releaseMenu();
      if (request !== revision || shown.length === 0) return;
      const window = getCurrentWindow();
      const menu = await Menu.new({
        items: shown.map((entry, index) =>
          entry === "separator"
            ? { item: "Separator" as const }
            : {
                id: `${window.label}/context/${index}`,
                // Native menus interpret & as a mnemonic, including on macOS.
                text: entry.label.replace(/&/g, "&&"),
                enabled: !entry.disabled,
                action: () => {
                  if (request !== revision || entry.disabled) return;
                  // Focus the list/button before opening a dialog, so closing
                  // the dialog returns to its source rather than a text field.
                  if (returnTo.isConnected) returnTo.focus({ preventScroll: true });
                  try {
                    void Promise.resolve(entry.action()).catch(useNotify.getState().showError);
                  } catch (error) {
                    useNotify.getState().showError(error);
                  }
                },
              },
        ),
      });
      current = menu;
      if (request !== revision) {
        await releaseMenu();
        return;
      }
      // Some platforms return before selection. Keep the resource and its
      // handlers alive until the next popup or the owning row unmounts.
      await unwrap(commands.contextMenuPopup(menu.rid, position.x, position.y));
    })
    .catch(async (error: unknown) => {
      await releaseMenu().catch(() => {});
      useNotify.getState().showError(error);
    });
}

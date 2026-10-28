import { Menu, type MenuOptions } from "@tauri-apps/api/menu";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { flushSync } from "react-dom";

import { commands, unwrap } from "../ipc";

import { useNotify } from "../features/notify/notifyStore";
import { suppressTooltips } from "./tooltipState";

export type ContextMenuAction = {
  label: string;
  disabled?: boolean;
  /** Mutually exclusive choices within this menu. */
  checked?: boolean;
  action: () => unknown;
};
export type MenuSubmenu = { label: string; items: ContextMenuEntry[]; disabled?: boolean };
export type MenuGroup = { kind: "group"; label?: string; items: ContextMenuEntry[] };
export type ContextMenuEntry =
  ContextMenuAction | MenuSubmenu | MenuGroup | "separator" | false | null | undefined;

export function menuEntries(entries: ContextMenuEntry[]) {
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
  // WebKit does not focus clicked buttons until we do it explicitly. Radix
  // treats that post-pointerup focus as keyboard focus and reopens the tooltip,
  // so suppress it before focusing and before asynchronous menu creation.
  flushSync(suppressTooltips);
  if (returnTo.isConnected) returnTo.focus({ preventScroll: true });
  // Keep creation ordered: an older request must never replace a newer one's
  // action channels, even when IPC finishes after another right click.
  pending = pending
    .then(async () => {
      await releaseMenu();
      if (request !== revision || shown.length === 0) return;
      const window = getCurrentWindow();
      const items = (
        entries: ContextMenuEntry[],
        path: string,
      ): NonNullable<MenuOptions["items"]> =>
        menuEntries(entries).flatMap((entry, index): NonNullable<MenuOptions["items"]> => {
          const id = `${path}/${index}`;
          if (entry === "separator") return [{ item: "Separator" }];
          if ("kind" in entry) {
            const children = items(entry.items, id);
            return entry.label
              ? [{ id, text: entry.label.replace(/&/g, "&&"), enabled: false }, ...children]
              : children;
          }
          const text = entry.label.replace(/&/g, "&&");
          if ("items" in entry)
            return [{ id, text, enabled: !entry.disabled, items: items(entry.items, id) }];
          return [
            {
              id,
              text,
              enabled: !entry.disabled,
              ...(entry.checked === undefined ? {} : { checked: entry.checked }),
              action: () => {
                if (request !== revision || entry.disabled) return;
                // Capture the source before an action opens a dialog.
                if (returnTo.isConnected) returnTo.focus({ preventScroll: true });
                try {
                  void Promise.resolve(entry.action()).catch(useNotify.getState().showError);
                } catch (error) {
                  useNotify.getState().showError(error);
                }
              },
            },
          ];
        });
      const menu = await Menu.new({ items: items(shown, `${window.label}/context`) });
      current = menu;
      if (request !== revision) {
        await releaseMenu();
        return;
      }
      // Some platforms return before selection. Keep the resource and its
      // handlers alive until the next popup or the owning row unmounts.
      // Commit the removal before the native event loop starts tracking input.
      flushSync(suppressTooltips);
      await unwrap(commands.contextMenuPopup(menu.rid, position.x, position.y));
    })
    .catch(async (error: unknown) => {
      await releaseMenu().catch(() => {});
      useNotify.getState().showError(error);
    });
}

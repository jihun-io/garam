import { isTauri } from "@tauri-apps/api/core";
import { Menu, MenuItem, PredefinedMenuItem, Submenu } from "@tauri-apps/api/menu";
import { getCurrentWindow, type Window } from "@tauri-apps/api/window";
import type { TFunction } from "i18next";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";

import {
  SHORTCUTS,
  isCommandEnabled,
  runCommand,
  subscribeCommands,
  type CommandId,
} from "../../lib/commands";
import { appNameKey } from "../../lib/appIdentity";
import { currentPlatform } from "../../lib/platform";

type Native =
  | "Separator"
  | "Undo"
  | "Redo"
  | "Cut"
  | "Copy"
  | "Paste"
  | "SelectAll"
  | "Services"
  | "Hide"
  | "HideOthers"
  | "ShowAll"
  | "Quit"
  | "Minimize"
  | "Maximize"
  | "BringAllToFront"
  | "CloseWindow"
  | "Fullscreen";

/** Menu label for a command; "Show in Finder" differs per platform. */
export function commandLabel(t: TFunction<["menu", "repos", "common"]>, id: CommandId): string {
  if (id === "repo.reveal") return t(`repos:open.reveal_${currentPlatform()}`);
  return t(`menu:commands.${id}`, { appName: t(`common:${appNameKey}`) });
}

/**
 * Builds the native menu bar (docs/UI.md 6). Items run registered commands
 * and are enabled only while a screen offers them.
 */
async function buildMenu(
  t: TFunction<["menu", "repos", "common"]>,
  items: Map<CommandId, MenuItem>,
  windowLabel: string,
) {
  const mac = currentPlatform() === "macos";
  const appName = t(`common:${appNameKey}`);
  const command = async (id: CommandId) => {
    const item = await MenuItem.new({
      // Item ids are app-wide; each window builds its own menu.
      id: `${windowLabel}/${id}`,
      text: commandLabel(t, id),
      accelerator: SHORTCUTS[id] ?? undefined,
      enabled: isCommandEnabled(id),
      action: () => void runCommand(id),
    });
    items.set(id, item);
    return item;
  };
  const native = (item: Native, text?: string) => PredefinedMenuItem.new({ item, text });
  const separator = () => native("Separator");
  const submenu = async (text: string, children: Promise<unknown>[]) =>
    Submenu.new({ text, items: (await Promise.all(children)) as MenuItem[] });

  const app = mac
    ? [
        submenu(appName, [
          command("app.about"),
          command("app.checkUpdates"),
          separator(),
          command("settings"),
          separator(),
          native("Services", t("menu:native.services")),
          separator(),
          native("Hide", t("menu:native.hide", { appName })),
          native("HideOthers", t("menu:native.hideOthers")),
          native("ShowAll", t("menu:native.showAll")),
          separator(),
          native("Quit", t("menu:native.quit", { appName })),
        ]),
      ]
    : [];
  const file = submenu(t("menu:menus.file"), [
    command("repo.create"),
    command("repo.add"),
    command("repo.clone"),
    ...(mac
      ? []
      : [
          separator(),
          command("settings"),
          separator(),
          native("Quit", t("menu:native.quitOther")),
        ]),
  ]);
  const edit = submenu(t("menu:menus.edit"), [
    native("Undo", t("menu:native.undo")),
    native("Redo", t("menu:native.redo")),
    separator(),
    native("Cut", t("menu:native.cut")),
    native("Copy", t("menu:native.copy")),
    native("Paste", t("menu:native.paste")),
    native("SelectAll", t("menu:native.selectAll")),
  ]);
  const view = submenu(t("menu:menus.view"), [
    command("view.changes"),
    command("view.history"),
    command("history.search"),
    separator(),
    command("view.repositories"),
    command("view.branches"),
    separator(),
    command("view.refresh"),
    ...(mac ? [separator(), native("Fullscreen", t("menu:native.fullscreen"))] : []),
  ]);
  const repository = submenu(t("menu:menus.repository"), [
    command("sync.fetch"),
    command("sync.pull"),
    command("sync.push"),
    separator(),
    command("repo.stash"),
    separator(),
    command("repo.openEditor"),
    command("repo.openTerminal"),
    command("repo.reveal"),
    separator(),
    command("repo.recover"),
  ]);
  const branch = submenu(t("menu:menus.branch"), [
    command("branch.create"),
    command("branch.rename"),
    command("branch.cleanup"),
    separator(),
    command("branch.merge"),
    command("branch.compare"),
    separator(),
    command("branch.createPullRequest"),
    command("branch.viewPullRequest"),
  ]);
  const window = mac
    ? submenu(t("menu:menus.window"), [
        native("Minimize", t("menu:native.minimize")),
        native("Maximize", t("menu:native.zoom")),
        native("CloseWindow", t("menu:native.closeWindow")),
        separator(),
        native("BringAllToFront", t("menu:native.bringAllToFront")),
      ])
    : null;
  const help = submenu(t("menu:menus.help"), [
    command("help.shortcuts"),
    command("help.report"),
    ...(mac ? [] : [separator(), command("app.checkUpdates"), command("app.about")]),
  ]);

  const menus = await Promise.all([...app, file, edit, view, repository, branch, help]);
  const windowMenu = window ? await window : null;
  if (windowMenu) menus.splice(menus.length - 1, 0, windowMenu);
  const menu = await Menu.new({ items: menus });
  if (windowMenu) await windowMenu.setAsWindowsMenuForNSApp();
  await menus[menus.length - 1].setAsHelpMenuForNSApp().catch(() => {});
  return menu;
}

function currentWindow(): Window | null {
  try {
    return getCurrentWindow();
  } catch {
    return null; // Not running inside Tauri (tests).
  }
}

/**
 * Shows this window's menu. On macOS the menu bar belongs to the app, so
 * the focused window puts its own up; elsewhere each window has one.
 * Returns a function that stops following focus.
 */
async function install(menu: Menu, appWindow: Window | null): Promise<() => void> {
  if (currentPlatform() !== "macos") {
    await menu.setAsWindowMenu(appWindow ?? undefined);
    return () => {};
  }
  if (!appWindow || (await appWindow.isFocused())) await menu.setAsAppMenu();
  if (!appWindow) return () => {};
  return appWindow.onFocusChanged(({ payload: focused }) => {
    if (focused) void menu.setAsAppMenu().catch(() => {});
  });
}

/** Installs the menu bar and keeps item availability up to date. */
export function AppMenu() {
  const { t, i18n } = useTranslation(["menu", "repos", "common"]);

  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    let unsubscribe: (() => void) | undefined;
    let stopFollowingFocus: (() => void) | undefined;
    const appWindow = currentWindow();
    const items = new Map<CommandId, MenuItem>();
    const shown = new Map<CommandId, boolean>();
    let pending = false;
    // Registrations come in bursts (a screen mounting); update once after.
    const sync = () => {
      if (pending) return;
      pending = true;
      queueMicrotask(() => {
        pending = false;
        for (const [id, item] of items) {
          const enabled = isCommandEnabled(id);
          if (shown.get(id) === enabled) continue;
          shown.set(id, enabled);
          void item.setEnabled(enabled).catch(() => {});
        }
      });
    };

    buildMenu(t, items, appWindow?.label ?? "main")
      .then(async (menu) => {
        if (disposed) return;
        stopFollowingFocus = await install(menu, appWindow);
        if (disposed) {
          stopFollowingFocus();
          return;
        }
        // Screens may have offered commands while the items were being
        // made, so apply every item's current state once instead of
        // assuming it's what it was built with.
        unsubscribe = subscribeCommands(sync);
        sync();
      })
      .catch((error: unknown) => console.error("Couldn't set up the menu bar", error));
    return () => {
      disposed = true;
      unsubscribe?.();
      stopFollowingFocus?.();
    };
  }, [t, i18n.language]);

  return null;
}

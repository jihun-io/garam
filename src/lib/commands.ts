// Commands shared by the menu bar, keyboard shortcuts and tooltips
// (docs/UI.md 5–6). Screens register what a command does while they can do
// it; the menu reads whether each one is available right now.

import { useEffect, useRef, useSyncExternalStore } from "react";

import { currentPlatform } from "./platform";

/** Shortcut per command, in Tauri accelerator syntax. */
export const SHORTCUTS = {
  "repo.add": "CmdOrCtrl+O",
  "repo.create": "CmdOrCtrl+N",
  "repo.clone": "CmdOrCtrl+Shift+O",
  settings: "CmdOrCtrl+,",
  "view.changes": "CmdOrCtrl+1",
  "view.history": "CmdOrCtrl+2",
  "history.search": "CmdOrCtrl+F",
  "view.repositories": "CmdOrCtrl+T",
  "view.branches": "CmdOrCtrl+B",
  "view.refresh": "CmdOrCtrl+R",
  "sync.fetch": "CmdOrCtrl+Shift+T",
  "sync.pull": "CmdOrCtrl+Shift+L",
  "sync.push": "CmdOrCtrl+Shift+P",
  "repo.openEditor": "CmdOrCtrl+Shift+A",
  "repo.openTerminal": "Ctrl+`",
  "repo.reveal": "CmdOrCtrl+Shift+F",
  "branch.create": "CmdOrCtrl+Shift+N",
  "branch.rename": "CmdOrCtrl+Shift+R",
  "branch.merge": "CmdOrCtrl+Shift+M",
  "branch.compare": null,
  "repo.recover": null,
  "help.shortcuts": "CmdOrCtrl+/",
  "help.report": null,
  "app.checkUpdates": null,
} as const satisfies Record<string, string | null>;

export type CommandId = keyof typeof SHORTCUTS;

/** Shortcuts that act inside a screen rather than through the menu. */
export const LOCAL_SHORTCUTS = {
  commit: "CmdOrCtrl+Enter",
  discard: "CmdOrCtrl+Backspace",
} as const;

const MAC_SYMBOLS: Record<string, string> = {
  CMDORCTRL: "⌘",
  CTRL: "⌃",
  SHIFT: "⇧",
  ALT: "⌥",
  ENTER: "↩",
  BACKSPACE: "⌫",
};

/** "CmdOrCtrl+Shift+P" → "⇧⌘P" on macOS, "Ctrl+Shift+P" elsewhere. */
export function formatShortcut(accelerator: string, platform = currentPlatform()): string {
  const parts = accelerator.split("+");
  const key = parts.pop()!;
  if (platform === "macos") {
    // macOS lists modifiers in a fixed order: ⌃⌥⇧⌘.
    const order = ["CTRL", "ALT", "SHIFT", "CMDORCTRL"];
    const mods = parts
      .map((p) => p.toUpperCase())
      .sort((a, b) => order.indexOf(a) - order.indexOf(b))
      .map((p) => MAC_SYMBOLS[p] ?? p)
      .join("");
    return mods + (MAC_SYMBOLS[key.toUpperCase()] ?? key.toUpperCase());
  }
  const names: Record<string, string> = { CMDORCTRL: "Ctrl", CTRL: "Ctrl", SHIFT: "Shift" };
  const keyName = key.length === 1 ? key.toUpperCase() : key;
  return [...parts.map((p) => names[p.toUpperCase()] ?? p), keyName].join("+");
}

/** The formatted shortcut for a command, if it has one. */
export function shortcutFor(id: CommandId): string | null {
  const accelerator = SHORTCUTS[id];
  return accelerator ? formatShortcut(accelerator) : null;
}

type Handler = { run: () => void; enabled: boolean };

// Several screens may offer the same command; the latest registration wins.
const handlers = new Map<CommandId, Handler[]>();
const listeners = new Set<() => void>();
let version = 0;

function changed() {
  version++;
  listeners.forEach((fn) => fn());
}

function current(id: CommandId): Handler | undefined {
  const list = handlers.get(id);
  return list?.[list.length - 1];
}

export function isCommandEnabled(id: CommandId): boolean {
  return current(id)?.enabled ?? false;
}

/** Runs the command if a screen currently offers it. */
export function runCommand(id: CommandId): boolean {
  const handler = current(id);
  if (!handler?.enabled) return false;
  handler.run();
  return true;
}

export function subscribeCommands(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Re-renders when any command's availability changes. */
export function useCommandsVersion(): number {
  return useSyncExternalStore(subscribeCommands, () => version);
}

/** Offers `id` while the calling component is mounted and `enabled`. */
export function useCommand(id: CommandId, run: () => void, enabled = true) {
  // Keep the latest callback without re-registering on every render.
  const runRef = useRef(run);
  useEffect(() => {
    runRef.current = run;
  });

  useEffect(() => {
    const handler: Handler = { run: () => runRef.current(), enabled };
    const list = handlers.get(id) ?? [];
    handlers.set(id, [...list, handler]);
    changed();
    return () => {
      handlers.set(
        id,
        (handlers.get(id) ?? []).filter((h) => h !== handler),
      );
      changed();
    };
  }, [id, enabled]);
}

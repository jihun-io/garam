// Several selected rows in a list, the way file managers do it: a click
// picks one row, ⌘-click (Ctrl-click elsewhere) adds or removes one, and
// Shift extends a range from the anchor.

import { currentPlatform } from "./platform";

export type ListSelection = {
  keys: string[];
  /** Where a Shift range starts. */
  anchor: string | null;
  /** The row the keyboard is on. */
  focus: string | null;
};

export type SelectHow = "single" | "toggle" | "range";

export const NO_SELECTION: ListSelection = { keys: [], anchor: null, focus: null };

export const selectOnly = (key: string): ListSelection => ({
  keys: [key],
  anchor: key,
  focus: key,
});

/** How a click selects. On macOS, Ctrl-click is a right click, not a toggle. */
export function selectHow(
  e: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean },
  platform = currentPlatform(),
): SelectHow {
  if (e.shiftKey) return "range";
  return (platform === "macos" ? e.metaKey : e.ctrlKey) ? "toggle" : "single";
}

/** Whether a key press is ⌘A (Ctrl+A elsewhere). */
export function isSelectAll(
  e: { key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean },
  platform = currentPlatform(),
): boolean {
  const mod = platform === "macos" ? e.metaKey : e.ctrlKey;
  return mod && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "a";
}

/** The selection after picking `key` from the rows in `order`. */
export function select(
  order: string[],
  current: ListSelection,
  key: string,
  how: SelectHow,
): ListSelection {
  if (!order.includes(key)) return current;
  if (how === "single") return selectOnly(key);
  if (how === "toggle") {
    const keys = current.keys.includes(key)
      ? current.keys.filter((k) => k !== key)
      : [...current.keys, key];
    return { keys, anchor: key, focus: keys.length > 0 ? key : null };
  }
  const anchor = current.anchor !== null && order.includes(current.anchor) ? current.anchor : key;
  const [from, to] = [order.indexOf(anchor), order.indexOf(key)].sort((a, b) => a - b);
  return { keys: order.slice(from, to + 1), anchor, focus: key };
}

/** Every row, keeping where the keyboard is. */
export function selectAll(order: string[], current: ListSelection): ListSelection {
  const focus = current.focus !== null && order.includes(current.focus) ? current.focus : null;
  return {
    keys: [...order],
    anchor: current.anchor ?? order[0] ?? null,
    focus: focus ?? order[0] ?? null,
  };
}

/**
 * Moves the keyboard one row up or down; with `extend` (Shift), the range
 * from the anchor follows it.
 */
export function move(
  order: string[],
  current: ListSelection,
  delta: number,
  extend: boolean,
): ListSelection {
  if (order.length === 0) return current;
  const at = current.focus !== null ? order.indexOf(current.focus) : -1;
  const next = order[Math.max(0, Math.min(order.length - 1, at + delta))];
  return select(order, current, next, extend ? "range" : "single");
}

/**
 * Keeps only rows that still exist; with none left, the first row is
 * selected so there is always something to show. The keyboard may stay on
 * a row that was just deselected with ⌘-click.
 */
export function reconcile(order: string[], current: ListSelection): ListSelection {
  const keys = current.keys.filter((k) => order.includes(k));
  if (keys.length === 0) return order.length > 0 ? selectOnly(order[0]) : NO_SELECTION;
  const focus = current.focus !== null && order.includes(current.focus) ? current.focus : keys[0];
  const anchor = current.anchor !== null && order.includes(current.anchor) ? current.anchor : focus;
  return { keys, anchor, focus };
}

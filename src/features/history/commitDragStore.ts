import { create } from "zustand";

import type { CommitSummary } from "../../ipc";

/**
 * Commits being dragged from the history toward a branch. Pointer-driven
 * rather than HTML drag and drop, which the window's own file drop
 * handling intercepts on some platforms.
 */
export type CommitDrag = {
  /** Newest first. */
  commits: CommitSummary[];
  x: number;
  y: number;
  /** The branch under the pointer, if any. */
  over: string | null;
  /** Where in the history list the commits would move to (a row index). */
  insertAt: number | null;
};

export const useCommitDrag = create<{
  drag: CommitDrag | null;
  set: (drag: CommitDrag | null) => void;
}>((set) => ({
  drag: null,
  set: (drag) => set({ drag }),
}));

/** Marks an element as a place to drop commits onto `branch`. */
export const dropTarget = (branch: string) => ({ "data-drop-branch": branch });

export function branchUnder(target: EventTarget | null): string | null {
  const element = target instanceof Element ? target.closest("[data-drop-branch]") : null;
  return element?.getAttribute("data-drop-branch") ?? null;
}

/** The history row under the pointer, and whether the pointer is in its lower half. */
export function rowUnder(target: EventTarget | null, y: number): number | null {
  const row = target instanceof Element ? target.closest("[data-row-index]") : null;
  if (!row) return null;
  const index = Number(row.getAttribute("data-row-index"));
  const box = row.getBoundingClientRect();
  return y > box.top + box.height / 2 ? index + 1 : index;
}

import { create } from "zustand";

/** Whether the stash list under the changed files is open. Starts closed. */
export const useStashSection = create<{ open: boolean; toggle: () => void }>((set) => ({
  open: false,
  toggle: () => set((s) => ({ open: !s.open })),
}));

import { create } from "zustand";

import type { CommitSummary } from "../../ipc";

export type HistoryDialog = {
  kind: "reset" | "checkout" | "tag";
  commit: CommitSummary;
};

export const useHistoryDialog = create<{
  dialog: HistoryDialog | null;
  open: (dialog: HistoryDialog) => void;
  close: () => void;
}>((set) => ({
  dialog: null,
  open: (dialog) => set({ dialog }),
  close: () => set({ dialog: null }),
}));

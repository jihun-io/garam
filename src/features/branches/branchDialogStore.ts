import { create } from "zustand";

import type { Branch, CommitSummary } from "../../ipc";

export type BranchDialog =
  /** `from` starts the branch at that commit instead of HEAD. */
  | { kind: "create"; from?: CommitSummary }
  | { kind: "rename"; branch: Branch }
  | { kind: "delete"; branch: Branch }
  | { kind: "merge"; branch?: Branch }
  | { kind: "switch"; target: Branch };

export const useBranchDialog = create<{
  dialog: BranchDialog | null;
  open: (dialog: BranchDialog) => void;
  close: () => void;
}>((set) => ({
  dialog: null,
  open: (dialog) => set({ dialog }),
  close: () => set({ dialog: null }),
}));

import { create } from "zustand";

import type { Branch } from "../../ipc";

export type BranchDialog =
  | { kind: "create" }
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

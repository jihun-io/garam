import { create } from "zustand";

import type { AppError } from "../../ipc";

export type RepoDialog =
  { kind: "add"; path?: string; error?: AppError } | { kind: "create" } | { kind: "clone" };

/** Which repository dialog is open; lets any screen open one. */
export const useRepoDialog = create<{
  dialog: RepoDialog | null;
  open: (dialog: RepoDialog) => void;
  close: () => void;
}>((set) => ({
  dialog: null,
  open: (dialog) => set({ dialog }),
  close: () => set({ dialog: null }),
}));

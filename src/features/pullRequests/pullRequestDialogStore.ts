import { create } from "zustand";

/** Which branch the "create pull request" dialog is open for, if any. */
export const usePullRequestDialog = create<{
  branch: string | null;
  open: (branch: string) => void;
  close: () => void;
}>((set) => ({
  branch: null,
  open: (branch) => set({ branch }),
  close: () => set({ branch: null }),
}));

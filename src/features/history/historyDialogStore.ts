import { create } from "zustand";

import type { CommitSummary } from "../../ipc";

export type SquashOnto = {
  target: CommitSummary;
  head: string;
  branch: string;
  /** All rewritten commits, including intervening and later commits. */
  rewritten: CommitSummary[];
};

export type HistoryDialog =
  | { kind: "reset" | "checkout" | "tag"; commit: CommitSummary }
  | { kind: "reword" | "fixup"; commit: CommitSummary; head: string; branch: string }
  | { kind: "deleteTag"; commit: CommitSummary; tag: string }
  | { kind: "overwriteTag"; tag: string; remote: string }
  /** Newest first. */
  | { kind: "cherryPickOnto" | "reorder"; commits: CommitSummary[] }
  | { kind: "squash"; commits: CommitSummary[]; onto?: SquashOnto }
  | { kind: "compareBranch" }
  | { kind: "recover" };

export const useHistoryDialog = create<{
  dialog: HistoryDialog | null;
  open: (dialog: HistoryDialog) => void;
  close: () => void;
}>((set) => ({
  dialog: null,
  open: (dialog) => set({ dialog }),
  close: () => set({ dialog: null }),
}));

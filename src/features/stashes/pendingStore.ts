import { create } from "zustand";

/**
 * Per repository, the stash whose restore ran into conflicts. Once they
 * are resolved, the stash is still in the list, and the changes view
 * offers to discard it.
 */
export const usePendingStash = create<{
  pending: Record<string, string>;
  set: (repo: string, oid: string) => void;
  clear: (repo: string) => void;
}>((set) => ({
  pending: {},
  set: (repo, oid) => set((s) => ({ pending: { ...s.pending, [repo]: oid } })),
  clear: (repo) =>
    set((s) => ({
      pending: Object.fromEntries(Object.entries(s.pending).filter(([key]) => key !== repo)),
    })),
}));

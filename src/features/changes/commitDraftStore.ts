import { create } from "zustand";

export type CommitDraft = { summary: string; description: string };

/**
 * A message waiting to fill a repository's commit form, e.g. the one from
 * an undone commit. The form takes it when it next mounts.
 */
export const useCommitDrafts = create<{
  drafts: Record<string, CommitDraft>;
  set: (repo: string, draft: CommitDraft) => void;
  clear: (repo: string) => void;
}>((set) => ({
  drafts: {},
  set: (repo, draft) => set((s) => ({ drafts: { ...s.drafts, [repo]: draft } })),
  clear: (repo) =>
    set((s) => {
      const drafts = { ...s.drafts };
      delete drafts[repo];
      return { drafts };
    }),
}));

import { create } from "zustand";
import type { AmendSession } from "../../ipc";

export const useAmendSessions = create<{
  sessions: Record<string, AmendSession>;
  drafts: Record<string, { summary: string; body: string }>;
  updateDraft: (repo: string, draft: { summary: string; body: string }) => void;
  set: (repo: string, session: AmendSession) => void;
  clear: (repo: string) => void;
}>((set) => ({
  sessions: {},
  drafts: {},
  updateDraft: (repo, draft) => set((s) => ({ drafts: { ...s.drafts, [repo]: draft } })),
  set: (repo, session) =>
    set((s) => ({
      sessions: { ...s.sessions, [repo]: session },
      drafts: {
        ...s.drafts,
        [repo]:
          s.sessions[repo]?.id === session.id
            ? s.drafts[repo]
            : { summary: session.head.summary, body: session.head.body },
      },
    })),
  clear: (repo) =>
    set((s) => {
      const sessions = { ...s.sessions };
      const drafts = { ...s.drafts };
      delete drafts[repo];
      delete sessions[repo];
      return { sessions, drafts };
    }),
}));

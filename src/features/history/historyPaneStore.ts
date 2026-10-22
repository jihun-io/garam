import { create } from "zustand";

import type { CompareMode } from "../../ipc";

/** What the history's main pane shows instead of the selected row. */
export type HistoryPane =
  | {
      kind: "compare";
      /** Commit ids or full ref names. */
      base: string;
      target: string;
      mode: CompareMode;
      baseLabel: string;
      targetLabel: string;
    }
  /** A commit the list doesn't hold, e.g. a lost one from the reflog. */
  | { kind: "commit"; oid: string };

export const useHistoryPane = create<{
  panes: Record<string, HistoryPane | undefined>;
  show: (repo: string, pane: HistoryPane) => void;
  close: (repo: string) => void;
}>((set) => ({
  panes: {},
  show: (repo, pane) => set((s) => ({ panes: { ...s.panes, [repo]: pane } })),
  close: (repo) => set((s) => ({ panes: { ...s.panes, [repo]: undefined } })),
}));

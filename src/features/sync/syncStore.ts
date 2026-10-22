import { create } from "zustand";

import type { Progress } from "../../ipc";

export type SyncAction = "fetch" | "pull" | "push" | "publish";

export type RunningSync = {
  action: SyncAction;
  operationId: string;
  progress: Progress | null;
  /** Started by the background timer rather than the user. */
  background: boolean;
};

/** The network operation running in each repository; at most one at a time. */
export const useSyncStore = create<{
  running: Record<string, RunningSync>;
  /** Returns false if `repo` is already busy. */
  start: (repo: string, run: RunningSync) => boolean;
  setProgress: (repo: string, operationId: string, progress: Progress) => void;
  finish: (repo: string, operationId: string) => void;
}>((set, get) => ({
  running: {},
  start: (repo, run) => {
    if (get().running[repo]) return false;
    set((s) => ({ running: { ...s.running, [repo]: run } }));
    return true;
  },
  setProgress: (repo, operationId, progress) =>
    set((s) => {
      const run = s.running[repo];
      if (run?.operationId !== operationId) return s;
      return { running: { ...s.running, [repo]: { ...run, progress } } };
    }),
  finish: (repo, operationId) =>
    set((s) => {
      if (s.running[repo]?.operationId !== operationId) return s;
      const running = { ...s.running };
      delete running[repo];
      return { running };
    }),
}));

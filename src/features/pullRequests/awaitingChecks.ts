import { create } from "zustand";

/**
 * How long after a push or a new pull request GitHub may take to queue
 * its checks. Until they show up, a pull request reads "no checks".
 */
export const AWAIT_CHECKS_MS = 2 * 60 * 1000;
/** How often to look meanwhile. */
export const AWAIT_CHECKS_POLL_MS = 15 * 1000;

/** When each repository last pushed or made a pull request. */
export const useAwaitingChecks = create<{
  since: Record<string, number>;
  expect: (repo: string) => void;
}>((set) => ({
  since: {},
  expect: (repo) => set((s) => ({ since: { ...s.since, [repo]: Date.now() } })),
}));

/** Whether checks may still be on their way for `repo`. */
export function awaitingChecks(repo: string, now = Date.now()): boolean {
  const since = useAwaitingChecks.getState().since[repo];
  return since !== undefined && now - since < AWAIT_CHECKS_MS;
}

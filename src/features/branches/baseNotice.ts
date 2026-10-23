import { create } from "zustand";

import type { BaseStatus } from "../../ipc";

/** Commits behind the base that are worth a notice even without conflicts. */
export const FAR_BEHIND = 10;

/** What the banner showed when "Later" was pressed. */
export type Dismissed = { conflicts: string[]; behind: number };

/**
 * Whether the base branch has moved on enough to say so: it would conflict,
 * or it is `FAR_BEHIND` commits ahead. Telling every time main moves would
 * teach people to ignore the banner. After "Later", only something new
 * brings it back: a file that starts to conflict, or another `FAR_BEHIND`
 * commits.
 */
export function shouldNotify(
  status: BaseStatus | null | undefined,
  dismissed?: Dismissed,
): boolean {
  if (!status || status.behind === 0) return false;
  const conflicts = status.conflicts ?? [];
  if (conflicts.length === 0 && status.behind < FAR_BEHIND) return false;
  if (!dismissed) return true;
  return (
    conflicts.some((path) => !dismissed.conflicts.includes(path)) ||
    status.behind >= dismissed.behind + FAR_BEHIND
  );
}

/** "Later" answers, per repository, for as long as the window is open. */
export const useBaseNotices = create<{
  dismissed: Record<string, Dismissed>;
  dismiss: (repo: string, status: BaseStatus) => void;
}>((set) => ({
  dismissed: {},
  dismiss: (repo, status) =>
    set((s) => ({
      dismissed: {
        ...s.dismissed,
        [repo]: { conflicts: status.conflicts ?? [], behind: status.behind },
      },
    })),
}));

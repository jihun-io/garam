import { useEffect, useRef } from "react";

import type { ErrorCode } from "../../ipc";
import { useNotify } from "../notify/notifyStore";
import { useConflicts } from "./api";

/** Errors that only report conflicts were left to resolve. */
const CONFLICT_KINDS: ErrorCode[] = [
  "merge_conflict",
  "rebase_conflict",
  "revert_conflict",
  "cherry_pick_conflict",
];

/**
 * Closes a "stopped because of conflicts" error once the conflicts are gone.
 * Errors otherwise stay until dismissed, but this one would go on telling
 * the user to resolve what they already have.
 */
export function useConflictNoticeCleanup(repo: string | null) {
  const state = useConflicts(repo ?? "", repo !== null).data;
  const notice = useNotify((s) => s.notice);
  const dismiss = useNotify((s) => s.dismiss);
  const conflicted = !!state && (!!state.operation || state.files.length > 0);
  const reportsConflicts = notice?.type === "error" && CONFLICT_KINDS.includes(notice.error.kind);
  // The error can arrive before the state is read again, while it still
  // says "no conflicts": close only once the conflicts were seen and ended.
  const seen = useRef<{ notice: typeof notice; conflicted: boolean }>({
    notice: null,
    conflicted: false,
  });
  useEffect(() => {
    if (!reportsConflicts) return;
    if (seen.current.notice !== notice) seen.current = { notice, conflicted: false };
    if (conflicted) seen.current.conflicted = true;
    else if (state && seen.current.conflicted) dismiss();
  }, [notice, reportsConflicts, conflicted, state, dismiss]);
}

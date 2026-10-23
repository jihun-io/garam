import { useTranslation } from "react-i18next";

import type { ApplyOutcome } from "../../ipc";
import { useNotify } from "../notify/notifyStore";
import { useStashActions } from "./api";
import { usePendingStash } from "./pendingStore";

/**
 * Brings a stash back, keeping it (`apply`) or removing it (`pop`), and
 * says how it went. Conflicts are left for the banner to explain.
 */
export function useRestoreStash(repo: string) {
  const { t } = useTranslation("stashes");
  const { apply } = useStashActions(repo);
  const { showError, showInfo } = useNotify();
  const setPending = usePendingStash((s) => s.set);

  const restore = (oid: string, pop: boolean, onDone?: (outcome: ApplyOutcome) => void) =>
    apply.mutate(
      { oid, pop },
      {
        onSuccess: (outcome) => {
          if (outcome === "conflicted") setPending(repo, oid);
          else if (outcome === "applied_unstaged") showInfo(t("done.unstaged"));
          else showInfo(t(pop ? "done.popped" : "done.applied"));
          onDone?.(outcome);
        },
        onError: showError,
      },
    );
  return { restore, busy: apply.isPending };
}

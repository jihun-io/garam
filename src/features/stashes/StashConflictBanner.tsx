import { useEffect } from "react";
import { useTranslation } from "react-i18next";

import { Icon } from "../../components/Icon";
import { Button } from "../../components/ui/Button";
import type { ConflictState } from "../../ipc";
import { useNotify } from "../notify/notifyStore";
import { stashTitle, useStashActions, useStashes } from "./api";
import { usePendingStash } from "./pendingStore";
import styles from "./Stashes.module.css";

/**
 * After restoring a stash ran into conflicts: what to do now, and once
 * they're resolved, whether to discard the stash, which git kept.
 */
export function StashConflictBanner({
  repo,
  conflicts,
}: {
  repo: string;
  conflicts: ConflictState | undefined;
}) {
  const { t } = useTranslation("stashes");
  const oid = usePendingStash((s) => s.pending[repo]);
  const clear = usePendingStash((s) => s.clear);
  const stashes = useStashes(repo);
  const { drop } = useStashActions(repo);
  const showError = useNotify((s) => s.showError);
  const stash = stashes.data?.find((s) => s.oid === oid);
  // Dropped or popped some other way: nothing left to offer.
  const gone = oid !== undefined && stashes.data !== undefined && !stash;
  useEffect(() => {
    if (gone) clear(repo);
  }, [gone, clear, repo]);

  if (!stash || !conflicts || conflicts.operation) return null;
  if (conflicts.files.length > 0) {
    return (
      <div className={styles.banner} role="status">
        <p className={styles.bannerTitle}>
          <Icon name="conflicted" size={16} />
          {t("conflict.title")}
        </p>
        <p>{t("conflict.body")}</p>
      </div>
    );
  }
  return (
    <div className={styles.banner} role="status">
      <p className={styles.bannerTitle}>
        <Icon name="success" size={16} />
        {t("conflict.resolvedTitle")}
      </p>
      <p>{t("conflict.resolvedBody", { title: stashTitle(t, stash) })}</p>
      <div className={styles.bannerActions}>
        <Button
          icon="discard"
          disabled={drop.isPending}
          onClick={() =>
            drop.mutate(stash.oid, { onSuccess: () => clear(repo), onError: showError })
          }
        >
          {t("conflict.drop")}
        </Button>
        <Button disabled={drop.isPending} onClick={() => clear(repo)}>
          {t("conflict.keep")}
        </Button>
      </div>
    </div>
  );
}

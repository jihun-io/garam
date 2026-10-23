import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "../../components/ui/Button";
import { FormDialog } from "../../components/ui/Dialog";
import { useNotify } from "../notify/notifyStore";
import { useStashActions } from "../stashes/api";
import { useRestoreStash } from "../stashes/useRestoreStash";
import { useAutoStash } from "./api";
import styles from "./branches.module.css";

/** Offers back the changes the user left on this branch. */
export function AutoStashBanner({ repo, branch }: { repo: string; branch: string | null }) {
  const { t } = useTranslation(["branches", "stashes"]);
  const stash = useAutoStash(repo, branch);
  const { restore, busy: restoring } = useRestoreStash(repo);
  const { drop, restore: undrop } = useStashActions(repo);
  const { showError, showInfo } = useNotify();
  const [confirmDrop, setConfirmDrop] = useState(false);

  if (!stash.data || !branch) return null;
  const oid = stash.data.oid;
  const busy = restoring || drop.isPending;

  return (
    <div className={styles.banner} role="status">
      <p>{t("stash.banner")}</p>
      <div className={styles.bannerActions}>
        <Button
          variant="primary"
          icon="restoreStash"
          disabled={busy}
          onClick={() => restore(oid, true)}
        >
          {t("stash.restore")}
        </Button>
        <Button icon="discard" disabled={busy} onClick={() => setConfirmDrop(true)}>
          {t("stash.discard")}
        </Button>
      </div>
      {confirmDrop && (
        <FormDialog
          open
          onOpenChange={(open) => !open && setConfirmDrop(false)}
          title={t("stash.discardTitle")}
          onSubmit={() =>
            drop.mutate(oid, {
              onSuccess: () => {
                setConfirmDrop(false);
                showInfo(t("stashes:done.dropped"), {
                  label: t("stashes:done.undo"),
                  run: () =>
                    undrop.mutate(oid, {
                      onSuccess: () => showInfo(t("stashes:done.restored")),
                      onError: showError,
                    }),
                });
              },
              onError: showError,
            })
          }
          footer={
            <>
              <Button onClick={() => setConfirmDrop(false)} autoFocus>
                {t("stash.keep")}
              </Button>
              <Button type="submit" variant="danger" disabled={busy}>
                {t("stash.discardConfirm")}
              </Button>
            </>
          }
        >
          <p>{t("stash.discardBody", { branch })}</p>
        </FormDialog>
      )}
    </div>
  );
}

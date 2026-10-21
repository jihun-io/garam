import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "../../components/ui/Button";
import { FormDialog } from "../../components/ui/Dialog";
import { useNotify } from "../notify/notifyStore";
import { useAutoStash, useBranchActions } from "./api";
import styles from "./branches.module.css";

/** Offers back the changes the user left on this branch. */
export function AutoStashBanner({ repo, branch }: { repo: string; branch: string | null }) {
  const { t } = useTranslation("branches");
  const stash = useAutoStash(repo, branch);
  const { popStash, dropStash } = useBranchActions(repo);
  const showError = useNotify((s) => s.showError);
  const [confirmDrop, setConfirmDrop] = useState(false);

  if (!stash.data || !branch) return null;
  const oid = stash.data.oid;
  const busy = popStash.isPending || dropStash.isPending;

  return (
    <div className={styles.banner} role="status">
      <p>{t("stash.banner")}</p>
      <div className={styles.bannerActions}>
        <Button
          variant="primary"
          disabled={busy}
          onClick={() => popStash.mutate(oid, { onError: showError })}
        >
          {t("stash.restore")}
        </Button>
        <Button disabled={busy} onClick={() => setConfirmDrop(true)}>
          {t("stash.discard")}
        </Button>
      </div>
      {confirmDrop && (
        <FormDialog
          open
          onOpenChange={(open) => !open && setConfirmDrop(false)}
          title={t("stash.discardTitle")}
          onSubmit={() =>
            dropStash.mutate(oid, {
              onSuccess: () => setConfirmDrop(false),
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

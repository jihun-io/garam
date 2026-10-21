import { useEffect } from "react";
import { useTranslation } from "react-i18next";

import { ErrorMessage } from "../../components/ErrorMessage";
import { Button } from "../../components/ui/Button";
import styles from "./Notifications.module.css";
import { useNotify } from "./notifyStore";

const INFO_TIMEOUT_MS = 4000;

export function Notifications() {
  const { t } = useTranslation();
  const { notice, dismiss } = useNotify();

  // Info notices go away on their own; errors stay until dismissed.
  useEffect(() => {
    if (notice?.type !== "info") return;
    const timer = setTimeout(dismiss, INFO_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [notice, dismiss]);

  if (!notice) return null;
  return (
    <div className={styles.root}>
      {notice.type === "error" ? (
        <ErrorMessage error={notice.error} />
      ) : (
        <p className={styles.info} role="status">
          {notice.message}
        </p>
      )}
      <Button variant="ghost" onClick={dismiss} aria-label={t("notify.dismiss")}>
        ✕
      </Button>
    </div>
  );
}

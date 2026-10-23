import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { ErrorMessage } from "../../components/ErrorMessage";
import { Icon } from "../../components/Icon";
import { Button } from "../../components/ui/Button";
import { IconButton } from "../../components/ui/IconButton";
import styles from "./Notifications.module.css";
import { useNotify } from "./notifyStore";

const INFO_TIMEOUT_MS = 4000;

/** Notices in the bottom-right corner; `children` (the update notice) stack
 * above them. */
export function Notifications({ children }: { children?: ReactNode }) {
  const { t } = useTranslation();
  const { notice, dismiss } = useNotify();
  const [hovered, setHovered] = useState(false);

  // Info notices go away on their own, but not while the pointer is on
  // them; errors stay until dismissed.
  useEffect(() => {
    if (notice?.type !== "info" || hovered) return;
    const timer = setTimeout(dismiss, INFO_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [notice, hovered, dismiss]);

  const error = notice?.type === "error";
  return (
    <div className={styles.area}>
      {children}
      {notice && (
        <div
          className={styles.root}
          data-type={notice.type}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
        >
          <Icon name={error ? "error" : "success"} size={20} className={styles.icon} />
          <div className={styles.body}>
            {notice.type === "error" ? (
              <ErrorMessage error={notice.error} plain />
            ) : (
              <p role="status">{notice.message}</p>
            )}
            {notice.action && (
              <Button
                className={styles.action}
                onClick={() => {
                  notice.action!.run();
                  dismiss();
                }}
              >
                {notice.action.label}
              </Button>
            )}
          </div>
          <IconButton icon="close" size={16} label={t("notify.dismiss")} onClick={dismiss} />
        </div>
      )}
    </div>
  );
}

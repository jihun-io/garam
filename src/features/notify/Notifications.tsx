import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { ErrorMessage } from "../../components/ErrorMessage";
import { Icon } from "../../components/Icon";
import { IconButton } from "../../components/ui/IconButton";
import styles from "./Notifications.module.css";
import { useNotify } from "./notifyStore";

const INFO_TIMEOUT_MS = 4000;

export function Notifications() {
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

  if (!notice) return null;
  const error = notice.type === "error";
  return (
    <div
      className={styles.root}
      data-type={notice.type}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <Icon name={error ? "error" : "success"} size={20} className={styles.icon} />
      <div className={styles.body}>
        {error ? (
          <ErrorMessage error={notice.error} plain />
        ) : (
          <p role="status">{notice.message}</p>
        )}
      </div>
      <IconButton icon="close" size={16} label={t("notify.dismiss")} onClick={dismiss} />
    </div>
  );
}

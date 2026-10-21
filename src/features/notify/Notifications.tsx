import { useTranslation } from "react-i18next";

import { ErrorMessage } from "../../components/ErrorMessage";
import { Button } from "../../components/ui/Button";
import styles from "./Notifications.module.css";
import { useNotify } from "./notifyStore";

export function Notifications() {
  const { t } = useTranslation();
  const { error, dismiss } = useNotify();
  if (!error) return null;
  return (
    <div className={styles.root}>
      <ErrorMessage error={error} />
      <Button variant="ghost" onClick={dismiss} aria-label={t("notify.dismiss")}>
        ✕
      </Button>
    </div>
  );
}

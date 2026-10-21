import { useTranslation } from "react-i18next";

import styles from "./DropOverlay.module.css";

export function DropOverlay({ visible }: { visible: boolean }) {
  const { t } = useTranslation("repos");
  if (!visible) return null;
  return (
    <div className={styles.overlay} aria-hidden="true">
      <p>{t("drop.overlay")}</p>
    </div>
  );
}

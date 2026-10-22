import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { Icon } from "../Icon";
import styles from "./Loading.module.css";

/** Loads that finish within this long show nothing, so screens don't flash. */
export const LOADING_DELAY_MS = 300;

/**
 * A spinner with a label for content that is still loading (docs/UI.md 4.4).
 * Appears only after a short delay; the space is held either way.
 */
export function Loading({ label, inline = false }: { label?: string; inline?: boolean }) {
  const { t } = useTranslation();
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setShown(true), LOADING_DELAY_MS);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className={inline ? styles.inline : styles.root} role="status" aria-busy="true">
      {shown && (
        <>
          <Icon name="loading" className={styles.spinner} />
          <span>{label ?? t("loading")}</span>
        </>
      )}
    </div>
  );
}

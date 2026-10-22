import { useId, useState } from "react";
import { useTranslation } from "react-i18next";

import type { AppError } from "../ipc";
import styles from "./ErrorMessage.module.css";

/**
 * Shows a translated message for an AppError, with the raw detail on demand.
 * `plain` drops the box, for containers that already frame it.
 */
export function ErrorMessage({ error, plain = false }: { error: AppError; plain?: boolean }) {
  const { t } = useTranslation(["errors", "common"]);
  const [open, setOpen] = useState(false);
  const detailId = useId();

  return (
    <div className={plain ? styles.plain : styles.root} role="alert">
      <p>{t(error.kind, { replace: error.params })}</p>
      {error.detail && (
        <>
          <button
            type="button"
            className={styles.toggle}
            aria-expanded={open}
            aria-controls={detailId}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? t("common:error.hideDetails") : t("common:error.showDetails")}
          </button>
          {open && (
            <pre id={detailId} className={styles.detail}>
              {error.detail}
            </pre>
          )}
        </>
      )}
    </div>
  );
}

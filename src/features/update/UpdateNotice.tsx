import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { Icon } from "../../components/Icon";
import { Button } from "../../components/ui/Button";
import { commands } from "../../ipc";
import { useCommand } from "../../lib/commands";
import { useNotify } from "../notify/notifyStore";
import { checkForUpdates, installUpdate, releaseUrl, useUpdateStatus } from "./api";
import styles from "./UpdateNotice.module.css";

/** Offers "Check for Updates…" to the menu. */
export function UpdateCommands() {
  const { t } = useTranslation("update");
  const { showError, showInfo } = useNotify();
  const { installing, installed } = useUpdateStatus();
  const [checking, setChecking] = useState(false);

  useCommand(
    "app.checkUpdates",
    () => {
      setChecking(true);
      checkForUpdates()
        .then(async (found) => {
          // A found update shows up in the notice in every window.
          if (!found) showInfo(t("upToDate", { version: await getVersion() }));
        })
        .catch(showError)
        .finally(() => setChecking(false));
    },
    !checking && !installing && !installed,
  );
  return null;
}

/** A card above the notifications while a newer version is around. */
export function UpdateNotice() {
  const { t } = useTranslation("update");
  const showError = useNotify((s) => s.showError);
  const { available, installing, installed } = useUpdateStatus();
  // Only the window that started the download hears its progress.
  const [percent, setPercent] = useState<number | null>(null);

  if (installed) {
    return (
      <Card text={t("installed")}>
        <Button variant="primary" onClick={() => void commands.appRestart()}>
          {t("restart")}
        </Button>
      </Card>
    );
  }
  if (installing) {
    return (
      <Card
        text={percent === null ? t("installing") : t("downloading", { percent: String(percent) })}
      />
    );
  }
  if (!available) return null;

  const install = () => {
    setPercent(0);
    installUpdate(({ downloaded, total }) => {
      if (total) setPercent(Math.min(100, Math.floor((downloaded / total) * 100)));
    })
      .catch(showError)
      .finally(() => setPercent(null));
  };
  return (
    <Card text={t("available", { version: available.version })}>
      <Button variant="primary" icon="update" onClick={install}>
        {t("install")}
      </Button>
      <Button
        variant="ghost"
        icon="openIn"
        onClick={() => void openUrl(releaseUrl(available.version)).catch(showError)}
      >
        {t("notes")}
      </Button>
      <Button variant="ghost" onClick={() => void commands.updateDismiss()}>
        {t("later")}
      </Button>
    </Card>
  );
}

function Card({ text, children }: { text: string; children?: ReactNode }) {
  return (
    <div className={styles.root}>
      <Icon name="update" size={20} className={styles.icon} />
      <div className={styles.body}>
        <p role="status">{text}</p>
        {children && <div className={styles.actions}>{children}</div>}
      </div>
    </div>
  );
}

import { useTranslation } from "react-i18next";

import { toAppError } from "../../ipc";
import styles from "./Startup.module.css";
import { StartupError } from "./StartupError";
import { useGitInfo } from "./useGitInfo";
import { Welcome } from "./Welcome";

/** Blocks the app until a supported git is available. */
export function StartupGate() {
  const { t } = useTranslation("startup");
  const gitInfo = useGitInfo();

  if (gitInfo.isPending) {
    return (
      <main className={styles.screen}>
        <p className={styles.muted} role="status">
          {t("checking")}
        </p>
      </main>
    );
  }

  if (gitInfo.isError) {
    return (
      <StartupError
        error={toAppError(gitInfo.error)}
        retrying={gitInfo.isFetching}
        onRetry={() => void gitInfo.refetch()}
      />
    );
  }

  return <Welcome gitVersion={gitInfo.data.version} />;
}

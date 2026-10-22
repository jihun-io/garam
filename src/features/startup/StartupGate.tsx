import { useTranslation } from "react-i18next";

import { Loading } from "../../components/ui/Loading";
import { toAppError } from "../../ipc";
import { RepositoriesHome } from "../repos/RepositoriesHome";
import styles from "./Startup.module.css";
import { StartupError } from "./StartupError";
import { useGitInfo } from "./useGitInfo";

/** Blocks the app until a supported git is available. */
export function StartupGate() {
  const { t } = useTranslation("startup");
  const gitInfo = useGitInfo();

  if (gitInfo.isPending) {
    return (
      <main className={styles.screen}>
        <Loading label={t("checking")} />
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

  return <RepositoriesHome gitVersion={gitInfo.data.version} />;
}

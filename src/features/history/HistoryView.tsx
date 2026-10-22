import { useCallback, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { EmptyMessage } from "../../components/EmptyMessage";
import { ErrorMessage } from "../../components/ErrorMessage";
import { Loading } from "../../components/ui/Loading";
import { toAppError, type CommitSummary } from "../../ipc";
import { shortHash } from "../../lib/hash";
import { useBranchDialog } from "../branches/branchDialogStore";
import { useStatus } from "../changes/api";
import changesStyles from "../changes/ChangesView.module.css";
import { useNotify } from "../notify/notifyStore";
import { SidebarSplitter } from "../settings/SidebarSplitter";
import { useHistory, useRevert } from "./api";
import { CommitDetailView } from "./CommitDetailView";
import { CommitList } from "./CommitList";

/** Commit list on the left, the selected commit on the right. */
export function HistoryView({ repo, tabs }: { repo: string; tabs: ReactNode }) {
  const { t } = useTranslation("history");
  const status = useStatus(repo);
  const history = useHistory(repo, status.data?.branch.oid);
  const revert = useRevert(repo);
  const openBranchDialog = useBranchDialog((s) => s.open);
  const { showError, showInfo } = useNotify();
  const [selectedOid, setSelectedOid] = useState<string | null>(null);

  const commits = history.data?.pages.flat() ?? [];
  const selected = commits.find((c) => c.oid === selectedOid) ?? commits[0] ?? null;
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = history;
  const loadMore = useCallback(() => {
    if (!isFetchingNextPage) void fetchNextPage();
  }, [isFetchingNextPage, fetchNextPage]);

  const copyHash = (oid: string) => {
    navigator.clipboard
      .writeText(oid)
      .then(() => showInfo(t("menu.copied", { hash: shortHash(oid) })))
      .catch(showError);
  };

  const actions = {
    copyHash: (commit: CommitSummary) => copyHash(commit.oid),
    createBranch: (commit: CommitSummary) => openBranchDialog({ kind: "create", from: commit }),
    revert: (commit: CommitSummary) =>
      revert.mutate(commit.oid, {
        onSuccess: () => showInfo(t("reverted", { summary: commit.summary })),
        onError: showError,
      }),
  };

  let main;
  if (history.isError) {
    main = (
      <div className={changesStyles.error}>
        <ErrorMessage error={toAppError(history.error)} />
      </div>
    );
  } else if (selected) {
    main = <CommitDetailView repo={repo} oid={selected.oid} onCopyHash={copyHash} />;
  } else if (history.data) {
    main = <EmptyMessage icon="history" title={t("list.empty")} />;
  } else {
    main = <Loading />;
  }

  return (
    <div className={changesStyles.root}>
      <aside className={changesStyles.sidebar}>
        {tabs}
        <CommitList
          commits={commits}
          selectedOid={selected?.oid ?? null}
          onSelect={setSelectedOid}
          hasMore={hasNextPage}
          loadMore={loadMore}
          actions={actions}
        />
        <SidebarSplitter />
      </aside>
      <div className={changesStyles.main}>{main}</div>
    </div>
  );
}

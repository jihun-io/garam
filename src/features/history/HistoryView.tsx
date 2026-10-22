import { save } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { EmptyMessage } from "../../components/EmptyMessage";
import { ErrorMessage } from "../../components/ErrorMessage";
import { Button } from "../../components/ui/Button";
import { Loading } from "../../components/ui/Loading";
import { commands, toAppError, unwrap } from "../../ipc";
import { runCommand } from "../../lib/commands";
import { shortHash } from "../../lib/hash";
import { useBranchDialog } from "../branches/branchDialogStore";
import { useStatus } from "../changes/api";
import { useCommitDrafts } from "../changes/commitDraftStore";
import changesStyles from "../changes/ChangesView.module.css";
import { useNotify } from "../notify/notifyStore";
import { SidebarSplitter } from "../settings/SidebarSplitter";
import { useCommitActions, useHistory, useHistoryMarkers, useRemoteWebUrl, useRevert } from "./api";
import { CommitDetailView } from "./CommitDetailView";
import { CommitList, type CommitActions } from "./CommitList";
import { isUnfiltered, useHistoryFilter, useHistoryFilters, useSettledFilter } from "./filterStore";
import { HistoryDialogs } from "./HistoryDialogs";
import { useHistoryDialog } from "./historyDialogStore";
import { HistorySearch } from "./HistorySearch";
import { buildGraph } from "./graph";
import { toMarks } from "./refs";
import { buildRows, graphNodes } from "./rows";

/** Commit list on the left, the selected commit on the right. */
export function HistoryView({ repo, tabs }: { repo: string; tabs: ReactNode }) {
  const { t } = useTranslation("history");
  const status = useStatus(repo);
  const markers = useHistoryMarkers(repo);
  const marks = useMemo(() => toMarks(markers.data), [markers.data]);
  const filter = useSettledFilter(useHistoryFilter(repo));
  const resetFilter = useHistoryFilters((s) => s.reset);
  const unfiltered = isUnfiltered(filter);
  // Beyond HEAD, the list depends on where every branch and tag points.
  const refs =
    filter.scope.kind === "head"
      ? ""
      : markers.data?.refs.map((r) => `${r.name}@${r.oid}`).join(" ");
  const history = useHistory(repo, status.data?.branch.oid, filter, refs);
  const revert = useRevert(repo);
  const commitActions = useCommitActions(repo);
  const openBranchDialog = useBranchDialog((s) => s.open);
  const openDialog = useHistoryDialog((s) => s.open);
  const setDraft = useCommitDrafts((s) => s.set);
  const { showError, showInfo } = useNotify();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const head = status.data?.branch.oid ?? null;

  // Uncommitted changes, commits waiting to be pulled and stashes join the
  // plain history; a search or filter shows only what it found.
  const pages = history.data?.pages;
  const changedFiles = status.data?.files.length ?? 0;
  const rows = useMemo(
    () =>
      buildRows({
        own: pages?.flat() ?? [],
        incoming: markers.data?.incoming ?? [],
        stashes: markers.data?.stashes ?? [],
        changedFiles,
        head,
        extras: unfiltered,
      }),
    [pages, markers.data, changedFiles, head, unfiltered],
  );
  // Searches list matches newest first and paths skip parents: no graph.
  const graphed = filter.query.trim() === "" && filter.path.trim() === "";
  const graph = useMemo(
    () => (graphed ? buildGraph(graphNodes(rows, head), filter.firstParent) : null),
    [graphed, rows, head, filter.firstParent],
  );
  // Until something is picked: HEAD's commit, or the first a search found.
  const selected =
    rows.find((r) => r.id === selectedId) ??
    rows.find((r) => r.id === head) ??
    rows.find((r) => r.kind === "commit" && marks.sync.get(r.id) !== "incoming") ??
    null;
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

  const hasRemote = markers.data?.refs.some((r) => r.kind === "remote") ?? false;
  const webUrl = useRemoteWebUrl(repo);
  const actions: CommitActions = {
    copyHash: (commit) => copyHash(commit.oid),
    createBranch: (commit) => openBranchDialog({ kind: "create", from: commit }),
    createTag: (commit) => openDialog({ kind: "tag", commit }),
    checkout: (commit) => openDialog({ kind: "checkout", commit }),
    reset: (commit) => openDialog({ kind: "reset", commit }),
    cherryPick: (commit) =>
      commitActions.cherryPick.mutate(commit.oid, {
        onSuccess: () => showInfo(t("done.cherryPicked", { summary: commit.summary })),
        onError: showError,
      }),
    revert: (commit) =>
      revert.mutate(commit.oid, {
        onSuccess: () => showInfo(t("reverted", { summary: commit.summary })),
        onError: showError,
      }),
    // The changes stay staged; the message goes back into the commit form.
    undo: (commit) =>
      commitActions.undo.mutate(commit.oid, {
        onSuccess: (undone) => {
          setDraft(repo, { summary: undone.summary, description: undone.body });
          runCommand("view.changes");
          showInfo(t("done.undone"));
        },
        onError: showError,
      }),
    copyPatch: (commit) =>
      void unwrap(commands.commitPatch(repo, commit.oid))
        .then((patch) => navigator.clipboard.writeText(patch))
        .then(() => showInfo(t("done.patchCopied", { summary: commit.summary })))
        .catch(showError),
    savePatch: (commit) =>
      void save({
        defaultPath: `${shortHash(commit.oid)}.patch`,
        filters: [{ name: "Patch", extensions: ["patch", "diff"] }],
      })
        .then(async (path) => {
          if (!path) return;
          await unwrap(commands.commitPatchSave(repo, commit.oid, path));
          showInfo(t("done.patchSaved"));
        })
        .catch(showError),
    openOnRemote: (commit) => void openUrl(`${webUrl}/commit/${commit.oid}`).catch(showError),
    available: (commit) => {
      const sync = marks.sync.get(commit.oid);
      // Listed from HEAD, so already on it (except commits not pulled yet).
      const onHead = filter.scope.kind === "head" && sync !== "incoming";
      return {
        cherryPick: head !== null && !onHead && commit.oid !== head,
        revert: sync !== "incoming",
        // Only before anyone else could have it.
        undo:
          commit.oid === head && commit.parents.length <= 1 && (sync === "unpushed" || !hasRemote),
        // Not there until pushed.
        openOnRemote: webUrl !== null && sync !== "unpushed",
      };
    },
  };

  let main;
  if (history.isError) {
    main = (
      <div className={changesStyles.error}>
        <ErrorMessage error={toAppError(history.error)} />
      </div>
    );
  } else if (selected?.kind === "wip") {
    main = (
      <EmptyMessage
        icon="modified"
        title={t("wip.title", { count: selected.count })}
        body={t("wip.body")}
      >
        <Button onClick={() => runCommand("view.changes")}>{t("wip.open")}</Button>
      </EmptyMessage>
    );
  } else if (selected) {
    main = (
      <CommitDetailView
        repo={repo}
        oid={selected.id}
        badges={marks.refs.get(selected.id) ?? []}
        sync={marks.sync.get(selected.id)}
        stash={selected.kind === "stash" ? selected.stash : undefined}
        onCopyHash={copyHash}
      />
    );
  } else if (history.data && !unfiltered) {
    main = (
      <EmptyMessage icon="search" title={t("search.noResults")} body={t("search.noResultsBody")}>
        <Button onClick={() => resetFilter(repo)}>{t("search.clear")}</Button>
      </EmptyMessage>
    );
  } else if (history.data) {
    main = <EmptyMessage icon="history" title={t("list.empty")} />;
  } else {
    main = <Loading />;
  }

  return (
    <div className={changesStyles.root}>
      <aside className={changesStyles.sidebar}>
        {tabs}
        <HistorySearch repo={repo} />
        <CommitList
          rows={rows}
          graph={graph}
          head={head}
          marks={marks}
          selectedId={selected?.id ?? null}
          onSelect={setSelectedId}
          hasMore={hasNextPage}
          loadMore={loadMore}
          actions={actions}
        />
        <SidebarSplitter />
        <HistoryDialogs repo={repo} />
      </aside>
      <div className={changesStyles.main}>{main}</div>
    </div>
  );
}

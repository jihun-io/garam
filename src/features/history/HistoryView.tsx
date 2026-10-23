import { save } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { EmptyMessage } from "../../components/EmptyMessage";
import { ErrorMessage } from "../../components/ErrorMessage";
import { Button } from "../../components/ui/Button";
import { Loading } from "../../components/ui/Loading";
import {
  commands,
  toAppError,
  unwrap,
  type CherryPickOutcome,
  type CommitSummary,
} from "../../ipc";
import { runCommand } from "../../lib/commands";
import { shortHash } from "../../lib/hash";
import { useBranchDialog } from "../branches/branchDialogStore";
import { useStatus } from "../changes/api";
import { useCommitDrafts } from "../changes/commitDraftStore";
import changesStyles from "../changes/ChangesView.module.css";
import { useNotify } from "../notify/notifyStore";
import { SidebarSplitter } from "../settings/SidebarSplitter";
import {
  useCommitActions,
  useHistory,
  useHistoryMarkers,
  useHistoryPreparePaths,
  useRemoteWebUrl,
  useRevert,
} from "./api";
import { CommitDetailView } from "./CommitDetailView";
import { CompareView } from "./CompareView";
import { CommitList, type CommitActions, type SelectHow } from "./CommitList";
import { isUnfiltered, useHistoryFilter, useHistoryFilters, useSettledFilter } from "./filterStore";
import { HistoryDialogs } from "./HistoryDialogs";
import { useHistoryDialog } from "./historyDialogStore";
import { useHistoryPane } from "./historyPaneStore";
import styles from "./History.module.css";
import { HistorySearch } from "./HistorySearch";
import { MultiSelectionView } from "./MultiSelectionView";
import { buildGraph } from "./graph";
import { toMarks } from "./refs";
import { buildRows, graphNodes } from "./rows";
import { NO_SELECTION, only, pick, type Selection } from "./selection";

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
  useHistoryPreparePaths(repo, filter.path.trim() !== "");
  const revert = useRevert(repo);
  const commitActions = useCommitActions(repo);
  const openBranchDialog = useBranchDialog((s) => s.open);
  const openDialog = useHistoryDialog((s) => s.open);
  const setDraft = useCommitDrafts((s) => s.set);
  const { showError, showInfo } = useNotify();
  const [selection, setSelection] = useState<Selection>(NO_SELECTION);
  const pane = useHistoryPane((s) => s.panes[repo]);
  const showPane = useHistoryPane((s) => s.show);
  const closePane = useHistoryPane((s) => s.close);
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
  const fallback =
    rows.find((r) => r.id === head) ??
    rows.find((r) => r.kind === "commit" && marks.sync.get(r.id) !== "incoming") ??
    null;
  const picked = rows.filter((r) => selection.ids.includes(r.id));
  const current: Selection =
    picked.length > 0 ? selection : fallback ? only(fallback.id) : NO_SELECTION;
  const selectedRows = picked.length > 0 ? picked : fallback ? [fallback] : [];
  const selected = selectedRows.length === 1 ? selectedRows[0] : null;
  const selectedCommits = selectedRows.flatMap((r) => (r.kind === "commit" ? [r.commit] : []));
  // Picking a row goes back from a comparison to the list.
  const select = (id: string, how: SelectHow = "single") => {
    setSelection(pick(rows, current, id, how));
    closePane(repo);
  };
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
    deleteTag: (commit, tag) => openDialog({ kind: "deleteTag", commit, tag }),
    tagsAt: (commit) =>
      (marks.refs.get(commit.oid) ?? []).filter((r) => r.kind === "tag").map((r) => r.name),
    checkout: (commit) => openDialog({ kind: "checkout", commit }),
    reset: (commit) => openDialog({ kind: "reset", commit }),
    cherryPick: (commit) =>
      commitActions.cherryPick.mutate([commit.oid], {
        onSuccess: () => showInfo(t("done.cherryPicked", { summary: commit.summary })),
        onError: showError,
      }),
    cherryPickOnto: (commit) => openDialog({ kind: "cherryPickOnto", commits: [commit] }),
    revert: (commit) =>
      revert.mutate([commit.oid], {
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
    compare: (commit) => compareWithSelected(commit.oid),
    many: {
      cherryPick: (commits) =>
        commitActions.cherryPick.mutate(commits.map((c) => c.oid).reverse(), {
          onSuccess: ({ picked, skipped }) =>
            showInfo(
              [
                t("done.cherryPickedMany", { count: picked }),
                skipped > 0 ? t("done.skipped", { count: skipped }) : "",
              ].join(" "),
            ),
          onError: showError,
        }),
      revert: (commits) =>
        revert.mutate(
          commits.map((c) => c.oid),
          {
            onSuccess: () => showInfo(t("done.revertedMany", { count: commits.length })),
            onError: showError,
          },
        ),
      cherryPickOnto: (commits) => openDialog({ kind: "cherryPickOnto", commits }),
      squash: (commits) => openDialog({ kind: "squash", commits }),
      available: (commits) => {
        const syncs = commits.map((c) => marks.sync.get(c.oid));
        const onHead = filter.scope.kind === "head" && !syncs.includes("incoming");
        // Squash needs commits one after another on this branch; git checks
        // the rest (first parents, no merges after them).
        const line = rows.filter((r) => r.kind === "commit" && marks.sync.get(r.id) !== "incoming");
        const positions = commits.map((c) => line.findIndex((r) => r.id === c.oid));
        const consecutive =
          !positions.includes(-1) &&
          Math.max(...positions) - Math.min(...positions) + 1 === commits.length;
        return {
          // Only commits HEAD doesn't have yet.
          cherryPick:
            head !== null &&
            (filter.scope.kind !== "head" || syncs.every((sync) => sync === "incoming")),
          revert: !syncs.includes("incoming"),
          // A search or path filter leaves gaps the list doesn't show.
          squash:
            onHead &&
            graphed &&
            consecutive &&
            commits.length > 1 &&
            commits.every((c) => c.parents.length <= 1),
        };
      },
    },
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
        compare: selected !== null && selected.kind !== "wip" && selected.id !== commit.oid,
      };
    },
  };

  // Commits that can move: this branch's own line, shown in full.
  const line = rows.filter((r) => r.kind === "commit" && marks.sync.get(r.id) !== "incoming");
  function canReorder(commits: CommitSummary[]) {
    return (
      filter.scope.kind === "head" &&
      graphed &&
      commits.every((c) => line.some((r) => r.id === c.oid) && c.parents.length <= 1)
    );
  }

  /** Moves dragged commits (newest first) to before row `insertAt`. */
  function reorder(commits: CommitSummary[], insertAt: number) {
    const moving = new Set(commits.map((c) => c.oid));
    const before = line.flatMap((r) => (r.kind === "commit" ? [r.commit] : []));
    const rest = before.filter((c) => !moving.has(c.oid));
    // Where the drop lands among the commits that stay.
    const at = line.filter((r) => rows.indexOf(r) < insertAt && !moving.has(r.id)).length;
    const after = [...rest.slice(0, at), ...commits, ...rest.slice(at)];
    // Only down to the deepest commit that moved.
    let depth = after.length - 1;
    while (depth >= 0 && after[depth].oid === before[depth].oid) depth--;
    if (depth < 0) return;
    const order = after.slice(0, depth + 1);
    const unpushed = new Set(markers.data?.unpushed ?? []);
    if (hasRemote && order.some((c) => !unpushed.has(c.oid))) {
      openDialog({ kind: "reorder", commits: order });
    } else {
      commitActions.reorder.mutate(
        order.map((c) => c.oid),
        { onSuccess: () => showInfo(t("done.reordered")), onError: showError },
      );
    }
  }

  /** Cherry-picks dragged commits (newest first) onto `branch`. */
  function dropOnBranch(commits: CommitSummary[], branch: string) {
    const oids = commits.map((c) => c.oid).reverse();
    const report = ({ skipped }: CherryPickOutcome, done: string) =>
      showInfo([done, skipped > 0 ? t("done.skipped", { count: skipped }) : ""].join(" "));
    if (branch !== status.data?.branch.head) {
      commitActions.cherryPickOnto.mutate(
        { branch, oids },
        {
          onSuccess: (outcome) =>
            report(outcome, t("done.cherryPickedOnto", { count: outcome.picked, branch })),
          onError: showError,
        },
      );
    } else if (!actions.many.available(commits).cherryPick) {
      showInfo(t("drag.alreadyThere"));
    } else {
      commitActions.cherryPick.mutate(oids, {
        onSuccess: (outcome) =>
          report(outcome, t("done.cherryPickedMany", { count: outcome.picked })),
        onError: showError,
      });
    }
  }

  /** Compares the selected row with `id`, the older one as the base. */
  function compareWithSelected(id: string) {
    if (!selected || selected.kind === "wip" || selected.id === id) return select(id);
    const other = rows.find((r) => r.id === id);
    if (!other || other.kind === "wip") return;
    const [base, target] =
      rows.indexOf(other) > rows.indexOf(selected) ? [other, selected] : [selected, other];
    const label = (row: typeof other) => shortHash(row.id);
    showPane(repo, {
      kind: "compare",
      base: base.id,
      target: target.id,
      mode: "two_dot",
      baseLabel: label(base),
      targetLabel: label(target),
    });
  }

  let main;
  if (!pane && selectedCommits.length > 1) {
    main = (
      <MultiSelectionView
        key={selectedCommits.map((c) => c.oid).join()}
        repo={repo}
        commits={selectedCommits}
        actions={actions.many}
        onClear={() => setSelection(NO_SELECTION)}
      />
    );
  } else if (pane?.kind === "compare") {
    main = (
      <CompareView
        repo={repo}
        pane={pane}
        onChange={(next) => showPane(repo, next)}
        onClose={() => closePane(repo)}
      />
    );
  } else if (pane?.kind === "commit") {
    main = (
      <div className={styles.peek}>
        <div className={styles.peekBar}>
          <p>{t("peek.note")}</p>
          <Button
            onClick={() =>
              openBranchDialog({
                kind: "create",
                from: {
                  oid: pane.oid,
                  parents: [],
                  authorName: "",
                  authorEmail: "",
                  authoredAt: 0,
                  summary: shortHash(pane.oid),
                },
              })
            }
          >
            {t("peek.createBranch")}
          </Button>
          <Button variant="ghost" onClick={() => closePane(repo)}>
            {t("peek.close")}
          </Button>
        </div>
        <CommitDetailView
          repo={repo}
          oid={pane.oid}
          badges={[]}
          sync={undefined}
          onCopyHash={copyHash}
        />
      </div>
    );
  } else if (history.isError) {
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
          selectedIds={new Set(selectedRows.map((r) => r.id))}
          focusId={current.focus}
          onSelect={select}
          onDrop={dropOnBranch}
          canReorder={canReorder}
          onReorder={reorder}
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

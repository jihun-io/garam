import { useVirtualizer } from "@tanstack/react-virtual";
import { ContextMenu } from "radix-ui";
import { Fragment, useEffect, useRef, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

import { Icon } from "../../components/Icon";
import menu from "../../components/ui/Menu.module.css";
import { Tooltip } from "../../components/ui/Tooltip";
import type { CommitSummary } from "../../ipc";
import { currentPlatform } from "../../lib/platform";
import { useRelativeTime } from "../../lib/time";
import { branchUnder, rowUnder, useCommitDrag, type CommitDrag } from "./commitDragStore";
import { CommitTitle } from "./CommitTitle";
import type { Graph } from "./graph";
import { GraphCell, type NodeShape } from "./GraphCell";
import styles from "./History.module.css";
import { RefBadges, SyncMark } from "./RefBadges";
import type { HistoryMarks } from "./refs";
import { stashTitle, type HistoryRow } from "./rows";

export type SelectHow = "single" | "toggle" | "range";

const ROW_HEIGHT = 48;
/** How far the pointer moves before a press becomes a drag. */
const DRAG_DISTANCE = 4;
/** Start loading the next page this many rows before the end. */
const PREFETCH_ROWS = 20;

type Action = (commit: CommitSummary) => void;

export type CommitActions = {
  copyHash: Action;
  createBranch: Action;
  createTag: Action;
  deleteTag: (commit: CommitSummary, tag: string) => void;
  /** Tags at the commit, for the menu. */
  tagsAt: (commit: CommitSummary) => string[];
  checkout: Action;
  cherryPick: Action;
  cherryPickOnto: Action;
  revert: Action;
  undo: Action;
  reset: Action;
  copyPatch: Action;
  savePatch: Action;
  openOnRemote: Action;
  compare: Action;
  /** Actions on several selected commits, given newest first. */
  many: {
    cherryPick: (commits: CommitSummary[]) => void;
    cherryPickOnto: (commits: CommitSummary[]) => void;
    revert: (commits: CommitSummary[]) => void;
    squash: (commits: CommitSummary[]) => void;
    available: (commits: CommitSummary[]) => {
      cherryPick: boolean;
      revert: boolean;
      squash: boolean;
    };
  };
  /** Which actions make sense for this commit right now. */
  available: (commit: CommitSummary) => {
    cherryPick: boolean;
    revert: boolean;
    undo: boolean;
    openOnRemote: boolean;
    compare: boolean;
  };
};

export function CommitList({
  rows,
  graph,
  head,
  marks,
  selectedIds,
  focusId,
  onSelect,
  onDrop,
  canReorder,
  onReorder,
  hasMore,
  loadMore,
  actions,
}: {
  rows: HistoryRow[];
  /** Lanes per row, or `null` when the list isn't drawn as a graph. */
  graph: Graph | null;
  head: string | null;
  marks: HistoryMarks;
  selectedIds: ReadonlySet<string>;
  /** The row the keyboard is on (the last one picked). */
  focusId: string | null;
  /** `toggle`: Cmd/Ctrl-click; `range`: Shift-click or Shift+arrow. */
  onSelect: (id: string, how: SelectHow) => void;
  /** Commits (newest first) dropped on a branch. */
  onDrop: (commits: CommitSummary[], branch: string) => void;
  /** Whether these commits can be moved within the list. */
  canReorder: (commits: CommitSummary[]) => boolean;
  /** Commits (newest first) dropped before row `insertAt`. */
  onReorder: (commits: CommitSummary[], insertAt: number) => void;
  hasMore: boolean;
  loadMore: () => void;
  actions: CommitActions;
}) {
  const { t } = useTranslation("history");
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length + (hasMore ? 1 : 0),
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  });
  const items = virtualizer.getVirtualItems();
  const lastIndex = items[items.length - 1]?.index ?? 0;
  const selectedIndex = rows.findIndex((r) => r.id === focusId);
  const drag = useCommitDrag((s) => s.drag);
  const setDrag = useCommitDrag((s) => s.set);
  const press = useRef<{
    id: string;
    x: number;
    y: number;
    commits: CommitSummary[];
    keep: boolean;
  } | null>(null);
  // Several selected commits, newest first, for the menu on any of them.
  const selection = rows.flatMap((r) =>
    selectedIds.has(r.id) && r.kind === "commit" ? [r.commit] : [],
  );

  // Pressing a commit and moving the pointer drags it (or all selected
  // commits): onto a branch to cherry-pick there, or between rows of the
  // list to move it.
  useEffect(() => {
    const move = (e: MouseEvent) => {
      const pressed = press.current;
      if (!pressed) return;
      const current = useCommitDrag.getState().drag;
      if (!current && Math.hypot(e.clientX - pressed.x, e.clientY - pressed.y) < DRAG_DISTANCE) {
        return;
      }
      setDrag({
        commits: pressed.commits,
        x: e.clientX,
        y: e.clientY,
        over: branchUnder(e.target),
        insertAt: canReorder(pressed.commits) ? rowUnder(e.target, e.clientY) : null,
      });
    };
    const up = (e: MouseEvent) => {
      const pressed = press.current;
      press.current = null;
      const current = useCommitDrag.getState().drag;
      if (current) {
        setDrag(null);
        const branch = branchUnder(e.target);
        if (branch) onDrop(current.commits, branch);
        else if (current.insertAt !== null) onReorder(current.commits, current.insertAt);
      } else if (pressed?.keep) {
        onSelect(pressed.id, "single");
      }
    };
    const key = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape" || !useCommitDrag.getState().drag) return;
      press.current = null;
      setDrag(null);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      window.removeEventListener("keydown", key);
    };
  }, [onDrop, onReorder, canReorder, onSelect, setDrag]);

  useEffect(() => {
    if (hasMore && lastIndex >= rows.length - PREFETCH_ROWS) loadMore();
  }, [hasMore, lastIndex, rows.length, loadMore]);

  useEffect(() => {
    if (selectedIndex >= 0) virtualizer.scrollToIndex(selectedIndex, { align: "auto" });
  }, [selectedIndex, virtualizer]);

  const onKeyDown = (e: KeyboardEvent) => {
    if (rows.length === 0 || (e.key !== "ArrowDown" && e.key !== "ArrowUp")) return;
    e.preventDefault();
    const delta = e.key === "ArrowDown" ? 1 : -1;
    const next = rows[Math.max(0, Math.min(rows.length - 1, selectedIndex + delta))];
    onSelect(next.id, e.shiftKey ? "range" : "single");
  };

  return (
    <div
      ref={scrollRef}
      className={styles.scroll}
      role="listbox"
      aria-label={t("list.label")}
      aria-multiselectable
      aria-activedescendant={selectedIndex >= 0 ? `commit-${selectedIndex}` : undefined}
      tabIndex={0}
      onKeyDown={onKeyDown}
    >
      <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
        {drag?.insertAt != null && drag.over === null && (
          <div className={styles.insertLine} style={{ top: drag.insertAt * ROW_HEIGHT - 1 }} />
        )}
        {items.map((item) => {
          const style = { height: item.size, transform: `translateY(${item.start}px)` };
          const row = rows[item.index];
          if (!row) {
            return (
              <p key="loading" className={`${styles.row} ${styles.loading}`} style={style}>
                {t("list.loading")}
              </p>
            );
          }
          const shape: NodeShape =
            row.kind === "commit" ? (row.id === head ? "head" : "commit") : row.kind;
          const option = (
            <div
              id={`commit-${item.index}`}
              role="option"
              aria-selected={selectedIds.has(row.id)}
              className={styles.row}
              data-kind={row.kind}
              data-sync={marks.sync.get(row.id)}
              data-row-index={item.index}
              style={style}
              onMouseDown={(e) => {
                // A right click opens the menu and keeps the selection, so
                // the menu can act on it.
                if (e.button !== 0) return;
                // On macOS, Ctrl-click is a right click.
                const toggle = currentPlatform() === "macos" ? e.metaKey : e.ctrlKey;
                if (e.shiftKey) e.preventDefault();
                const how = e.shiftKey ? "range" : toggle ? "toggle" : "single";
                // Pressing one of several selected commits may start dragging
                // them all, so it picks only that one if no drag follows.
                const keep = how === "single" && selection.length > 1 && selectedIds.has(row.id);
                if (!keep) onSelect(row.id, how);
                if (how === "single" && row.kind === "commit") {
                  press.current = {
                    id: row.id,
                    x: e.clientX,
                    y: e.clientY,
                    commits: keep ? selection : [row.commit],
                    keep,
                  };
                }
              }}
            >
              {graph && <GraphCell row={graph.rows[item.index]} height={item.size} shape={shape} />}
              <RowText row={row} marks={marks} />
            </div>
          );
          if (row.kind !== "commit") return <Fragment key={row.id}>{option}</Fragment>;
          return (
            <ContextMenu.Root key={row.id}>
              <ContextMenu.Trigger asChild>{option}</ContextMenu.Trigger>
              <ContextMenu.Portal>
                {selection.length > 1 && selectedIds.has(row.id) ? (
                  <ManyMenu commits={selection} actions={actions} />
                ) : (
                  <CommitMenu commit={row.commit} actions={actions} />
                )}
              </ContextMenu.Portal>
            </ContextMenu.Root>
          );
        })}
      </div>
      {drag && createPortal(<DragGhost drag={drag} />, document.body)}
    </div>
  );
}

/** Follows the pointer while commits are dragged. */
function DragGhost({ drag }: { drag: CommitDrag }) {
  const { t } = useTranslation("history");
  const label =
    drag.commits.length === 1
      ? drag.commits[0].summary
      : t("drag.many", { count: drag.commits.length });
  return (
    <div className={styles.dragGhost} style={{ left: drag.x + 12, top: drag.y + 12 }} aria-hidden>
      <Icon name="commit" size={14} />
      <span className={styles.dragLabel}>{label}</span>
      {drag.over ? (
        <span className={styles.dragTarget}>{t("drag.onto", { branch: drag.over })}</span>
      ) : (
        drag.insertAt !== null && <span className={styles.dragTarget}>{t("drag.move")}</span>
      )}
    </div>
  );
}

function RowText({ row, marks }: { row: HistoryRow; marks: HistoryMarks }) {
  const { t } = useTranslation("history");
  const relativeTime = useRelativeTime();
  if (row.kind === "wip") {
    return (
      <span className={styles.rowText}>
        <span className={styles.summary}>{t("wip.title", { count: row.count })}</span>{" "}
        <span className={styles.meta}>{t("wip.meta")}</span>
      </span>
    );
  }
  const commit = row.commit;
  const sync = marks.sync.get(commit.oid);
  const title = row.kind === "stash" ? stashTitle(t, row.stash.message) : commit.summary;
  return (
    <span className={styles.rowText}>
      <span className={styles.titleLine}>
        {row.kind === "stash" && <Icon name="stash" size={14} />}
        <Tooltip content={title} whenTruncated>
          <span className={styles.summary}>
            {row.kind === "stash" ? title : <CommitTitle summary={title} />}
          </span>
        </Tooltip>{" "}
        <RefBadges badges={marks.refs.get(commit.oid) ?? []} />
      </span>
      {/* Keeps the two lines apart in the row's accessible name. */}{" "}
      <span className={styles.meta}>
        {sync && <SyncMark state={sync} />}
        {sync && " "}
        {row.kind === "stash" ? `${t("stash.label")} · ` : `${commit.authorName} · `}
        {relativeTime(commit.authoredAt)}
      </span>
    </span>
  );
}

function CommitMenu({ commit, actions }: { commit: CommitSummary; actions: CommitActions }) {
  const { t } = useTranslation("history");
  const can = actions.available(commit);
  const item = (label: string, action: Action) => (
    <ContextMenu.Item className={menu.item} onSelect={() => action(commit)}>
      {label}
    </ContextMenu.Item>
  );
  return (
    <ContextMenu.Content className={menu.content}>
      {item(t("menu.copyHash"), actions.copyHash)}
      {item(t("menu.copyPatch"), actions.copyPatch)}
      {item(t("menu.savePatch"), actions.savePatch)}
      {can.openOnRemote && item(t("menu.openOnRemote"), actions.openOnRemote)}
      {can.compare && item(t("menu.compare"), actions.compare)}
      <ContextMenu.Separator className={menu.separator} />
      {item(t("menu.createBranch"), actions.createBranch)}
      {item(t("menu.createTag"), actions.createTag)}
      {actions.tagsAt(commit).map((tag) => (
        <ContextMenu.Item
          key={tag}
          className={menu.item}
          onSelect={() => actions.deleteTag(commit, tag)}
        >
          {t("menu.deleteTag", { name: tag })}
        </ContextMenu.Item>
      ))}
      {item(t("menu.checkout"), actions.checkout)}
      <ContextMenu.Separator className={menu.separator} />
      {can.cherryPick && item(t("menu.cherryPick"), actions.cherryPick)}
      {item(t("menu.cherryPickOnto"), actions.cherryPickOnto)}
      {can.revert && item(t("menu.revert"), actions.revert)}
      {can.undo && item(t("menu.undo"), actions.undo)}
      {item(t("menu.reset"), actions.reset)}
    </ContextMenu.Content>
  );
}

/** The menu on one of several selected commits: acts on all of them. */
function ManyMenu({ commits, actions }: { commits: CommitSummary[]; actions: CommitActions }) {
  const { t } = useTranslation("history");
  const can = actions.many.available(commits);
  const count = commits.length;
  return (
    <ContextMenu.Content className={menu.content}>
      {can.cherryPick && (
        <ContextMenu.Item className={menu.item} onSelect={() => actions.many.cherryPick(commits)}>
          {t("menu.cherryPickMany", { count })}
        </ContextMenu.Item>
      )}
      <ContextMenu.Item className={menu.item} onSelect={() => actions.many.cherryPickOnto(commits)}>
        {t("menu.cherryPickOntoMany", { count })}
      </ContextMenu.Item>
      {can.revert && (
        <ContextMenu.Item className={menu.item} onSelect={() => actions.many.revert(commits)}>
          {t("menu.revertMany", { count })}
        </ContextMenu.Item>
      )}
      {can.squash && (
        <ContextMenu.Item className={menu.item} onSelect={() => actions.many.squash(commits)}>
          {t("menu.squash", { count })}
        </ContextMenu.Item>
      )}
    </ContextMenu.Content>
  );
}

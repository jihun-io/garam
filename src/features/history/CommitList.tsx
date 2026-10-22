import { useVirtualizer } from "@tanstack/react-virtual";
import { ContextMenu } from "radix-ui";
import { Fragment, useEffect, useRef, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";

import { Icon } from "../../components/Icon";
import menu from "../../components/ui/Menu.module.css";
import { Tooltip } from "../../components/ui/Tooltip";
import type { CommitSummary } from "../../ipc";
import { useRelativeTime } from "../../lib/time";
import type { Graph } from "./graph";
import { GraphCell, type NodeShape } from "./GraphCell";
import styles from "./History.module.css";
import { RefBadges, SyncMark } from "./RefBadges";
import type { HistoryMarks } from "./refs";
import { stashTitle, type HistoryRow } from "./rows";

const ROW_HEIGHT = 48;
/** Start loading the next page this many rows before the end. */
const PREFETCH_ROWS = 20;

type Action = (commit: CommitSummary) => void;

export type CommitActions = {
  copyHash: Action;
  createBranch: Action;
  createTag: Action;
  checkout: Action;
  cherryPick: Action;
  revert: Action;
  undo: Action;
  reset: Action;
  /** Which actions make sense for this commit right now. */
  available: (commit: CommitSummary) => { cherryPick: boolean; revert: boolean; undo: boolean };
};

export function CommitList({
  rows,
  graph,
  head,
  marks,
  selectedId,
  onSelect,
  hasMore,
  loadMore,
  actions,
}: {
  rows: HistoryRow[];
  /** Lanes per row, or `null` when the list isn't drawn as a graph. */
  graph: Graph | null;
  head: string | null;
  marks: HistoryMarks;
  selectedId: string | null;
  onSelect: (id: string) => void;
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
  const selectedIndex = rows.findIndex((r) => r.id === selectedId);

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
    onSelect(rows[Math.max(0, Math.min(rows.length - 1, selectedIndex + delta))].id);
  };

  return (
    <div
      ref={scrollRef}
      className={styles.scroll}
      role="listbox"
      aria-label={t("list.label")}
      aria-activedescendant={selectedIndex >= 0 ? `commit-${selectedIndex}` : undefined}
      tabIndex={0}
      onKeyDown={onKeyDown}
    >
      <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
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
              aria-selected={row.id === selectedId}
              className={styles.row}
              data-kind={row.kind}
              data-sync={marks.sync.get(row.id)}
              style={style}
              onMouseDown={() => onSelect(row.id)}
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
                <CommitMenu commit={row.commit} actions={actions} />
              </ContextMenu.Portal>
            </ContextMenu.Root>
          );
        })}
      </div>
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
          <span className={styles.summary}>{title}</span>
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
      <ContextMenu.Separator className={menu.separator} />
      {item(t("menu.createBranch"), actions.createBranch)}
      {item(t("menu.createTag"), actions.createTag)}
      {item(t("menu.checkout"), actions.checkout)}
      <ContextMenu.Separator className={menu.separator} />
      {can.cherryPick && item(t("menu.cherryPick"), actions.cherryPick)}
      {can.revert && item(t("menu.revert"), actions.revert)}
      {can.undo && item(t("menu.undo"), actions.undo)}
      {item(t("menu.reset"), actions.reset)}
    </ContextMenu.Content>
  );
}

import { useVirtualizer } from "@tanstack/react-virtual";
import { ContextMenu } from "radix-ui";
import { useEffect, useRef, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";

import menu from "../../components/ui/Menu.module.css";
import { Tooltip } from "../../components/ui/Tooltip";
import type { CommitSummary } from "../../ipc";
import { useRelativeTime } from "../../lib/time";
import styles from "./History.module.css";
import { RefBadges, SyncMark } from "./RefBadges";
import type { HistoryMarks } from "./refs";

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
  commits,
  marks,
  selectedOid,
  onSelect,
  hasMore,
  loadMore,
  actions,
}: {
  commits: CommitSummary[];
  marks: HistoryMarks;
  selectedOid: string | null;
  onSelect: (oid: string) => void;
  hasMore: boolean;
  loadMore: () => void;
  actions: CommitActions;
}) {
  const { t } = useTranslation("history");
  const relativeTime = useRelativeTime();
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: commits.length + (hasMore ? 1 : 0),
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  });
  const items = virtualizer.getVirtualItems();
  const lastIndex = items[items.length - 1]?.index ?? 0;
  const selectedIndex = commits.findIndex((c) => c.oid === selectedOid);

  useEffect(() => {
    if (hasMore && lastIndex >= commits.length - PREFETCH_ROWS) loadMore();
  }, [hasMore, lastIndex, commits.length, loadMore]);

  useEffect(() => {
    if (selectedIndex >= 0) virtualizer.scrollToIndex(selectedIndex, { align: "auto" });
  }, [selectedIndex, virtualizer]);

  const onKeyDown = (e: KeyboardEvent) => {
    if (commits.length === 0 || (e.key !== "ArrowDown" && e.key !== "ArrowUp")) return;
    e.preventDefault();
    const delta = e.key === "ArrowDown" ? 1 : -1;
    onSelect(commits[Math.max(0, Math.min(commits.length - 1, selectedIndex + delta))].oid);
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
          const commit = commits[item.index];
          if (!commit) {
            return (
              <p key="loading" className={`${styles.row} ${styles.loading}`} style={style}>
                {t("list.loading")}
              </p>
            );
          }
          const sync = marks.sync.get(commit.oid);
          return (
            <ContextMenu.Root key={commit.oid}>
              <ContextMenu.Trigger asChild>
                <div
                  id={`commit-${item.index}`}
                  role="option"
                  aria-selected={commit.oid === selectedOid}
                  className={styles.row}
                  data-sync={sync}
                  style={style}
                  onMouseDown={() => onSelect(commit.oid)}
                >
                  <span className={styles.titleLine}>
                    <Tooltip content={commit.summary} whenTruncated>
                      <span className={styles.summary}>{commit.summary}</span>
                    </Tooltip>{" "}
                    <RefBadges badges={marks.refs.get(commit.oid) ?? []} />
                  </span>
                  {/* Keeps the two lines apart in the row's accessible name. */}{" "}
                  <span className={styles.meta}>
                    {sync && <SyncMark state={sync} />}
                    {sync && " "}
                    {commit.authorName} · {relativeTime(commit.authoredAt)}
                  </span>
                </div>
              </ContextMenu.Trigger>
              <ContextMenu.Portal>
                <CommitMenu commit={commit} actions={actions} />
              </ContextMenu.Portal>
            </ContextMenu.Root>
          );
        })}
      </div>
    </div>
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

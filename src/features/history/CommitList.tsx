import { useVirtualizer } from "@tanstack/react-virtual";
import { ContextMenu } from "radix-ui";
import { useEffect, useRef, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";

import menu from "../../components/ui/Menu.module.css";
import type { CommitSummary } from "../../ipc";
import { relativeTime } from "../../lib/time";
import styles from "./History.module.css";

const ROW_HEIGHT = 48;
/** Start loading the next page this many rows before the end. */
const PREFETCH_ROWS = 20;

export type CommitActions = {
  copyHash: (commit: CommitSummary) => void;
  createBranch: (commit: CommitSummary) => void;
  revert: (commit: CommitSummary) => void;
};

export function CommitList({
  commits,
  selectedOid,
  onSelect,
  hasMore,
  loadMore,
  actions,
}: {
  commits: CommitSummary[];
  selectedOid: string | null;
  onSelect: (oid: string) => void;
  hasMore: boolean;
  loadMore: () => void;
  actions: CommitActions;
}) {
  const { t, i18n } = useTranslation("history");
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
          return (
            <ContextMenu.Root key={commit.oid}>
              <ContextMenu.Trigger asChild>
                <div
                  id={`commit-${item.index}`}
                  role="option"
                  aria-selected={commit.oid === selectedOid}
                  className={styles.row}
                  style={style}
                  onMouseDown={() => onSelect(commit.oid)}
                >
                  <span className={styles.summary}>{commit.summary}</span>
                  <span className={styles.meta}>
                    {commit.authorName} · {relativeTime(commit.authoredAt, i18n.language)}
                  </span>
                </div>
              </ContextMenu.Trigger>
              <ContextMenu.Portal>
                <ContextMenu.Content className={menu.content}>
                  <ContextMenu.Item className={menu.item} onSelect={() => actions.copyHash(commit)}>
                    {t("menu.copyHash")}
                  </ContextMenu.Item>
                  <ContextMenu.Item
                    className={menu.item}
                    onSelect={() => actions.createBranch(commit)}
                  >
                    {t("menu.createBranch")}
                  </ContextMenu.Item>
                  <ContextMenu.Separator className={menu.separator} />
                  <ContextMenu.Item className={menu.item} onSelect={() => actions.revert(commit)}>
                    {t("menu.revert")}
                  </ContextMenu.Item>
                </ContextMenu.Content>
              </ContextMenu.Portal>
            </ContextMenu.Root>
          );
        })}
      </div>
    </div>
  );
}

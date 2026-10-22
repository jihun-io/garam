import { ContextMenu, Popover } from "radix-ui";
import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "../../components/ui/Button";
import menu from "../../components/ui/Menu.module.css";
import type { Branch, BranchStatus } from "../../ipc";
import { relativeTime } from "../../lib/time";
import { useBranches } from "./api";
import { useBranchDialog } from "./branchDialogStore";
import { CommitCounts } from "./CommitCounts";
import styles from "./branches.module.css";
import { Icon } from "../../components/Icon";
import { ToolbarButton } from "../../components/ui/ToolbarButton";

/** Toolbar button showing the current branch, with a searchable list. */
export function BranchPicker({
  repo,
  status,
  onChoose,
}: {
  repo: string;
  status: BranchStatus;
  onChoose: (branch: Branch) => void;
}) {
  const { t, i18n } = useTranslation("branches");
  const branches = useBranches(repo);
  const openDialog = useBranchDialog((s) => s.open);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const current = status.head;

  const { local, remote } = useMemo(() => {
    const all = branches.data ?? [];
    const q = query.trim().toLocaleLowerCase();
    const match = (b: Branch) => !q || b.name.toLocaleLowerCase().includes(q);
    const localNames = new Set(all.filter((b) => b.kind === "local").map((b) => b.name));
    return {
      // Current branch first, then most recently committed.
      local: all
        .filter((b) => b.kind === "local" && match(b))
        .sort((a, b) => Number(b.isHead) - Number(a.isHead) || b.committedAt - a.committedAt),
      // Only remote branches you don't have locally yet.
      remote: all
        .filter((b) => b.kind === "remote" && match(b))
        .filter((b) => !localNames.has(b.name.slice((b.remote?.length ?? 0) + 1)))
        .sort((a, b) => a.name.localeCompare(b.name)),
    };
  }, [branches.data, query]);

  const choose = (branch: Branch) => {
    setOpen(false);
    setQuery("");
    if (!branch.isHead) onChoose(branch);
  };

  const fromPicker = (action: () => void) => {
    setOpen(false);
    action();
  };

  const onListKeyDown = (e: KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const items = Array.from(
      listRef.current?.querySelectorAll<HTMLButtonElement>("[data-branch-item]") ?? [],
    );
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    items[
      Math.max(0, Math.min(items.length - 1, index + (e.key === "ArrowDown" ? 1 : -1)))
    ]?.focus();
  };

  const row = (branch: Branch) => (
    <li key={branch.name}>
      <ContextMenu.Root>
        <ContextMenu.Trigger asChild disabled={branch.kind === "remote"}>
          <button
            type="button"
            data-branch-item
            className={styles.item}
            aria-current={branch.isHead ? "true" : undefined}
            onClick={() => choose(branch)}
          >
            <span className={styles.itemName}>{branch.name}</span>
            <span className={styles.itemMeta}>
              {branch.upstreamGone && <span className={styles.gone}>{t("picker.gone")}</span>}
              <CommitCounts ahead={branch.ahead} behind={branch.behind} />
              <span>{relativeTime(branch.committedAt, i18n.language)}</span>
            </span>
          </button>
        </ContextMenu.Trigger>
        <ContextMenu.Portal>
          <ContextMenu.Content className={menu.content}>
            <ContextMenu.Item
              className={menu.item}
              onSelect={() => fromPicker(() => openDialog({ kind: "rename", branch }))}
            >
              {t("picker.rename")}
            </ContextMenu.Item>
            {!branch.isHead && current && (
              <ContextMenu.Item
                className={menu.item}
                onSelect={() => fromPicker(() => openDialog({ kind: "merge", branch }))}
              >
                {t("picker.mergeThis", { branch: current })}
              </ContextMenu.Item>
            )}
            <ContextMenu.Separator className={menu.separator} />
            <ContextMenu.Item
              className={menu.item}
              disabled={branch.isHead}
              onSelect={() => fromPicker(() => openDialog({ kind: "delete", branch }))}
            >
              {t("picker.delete")}
            </ContextMenu.Item>
          </ContextMenu.Content>
        </ContextMenu.Portal>
      </ContextMenu.Root>
    </li>
  );

  const label = current ?? t("picker.detached");
  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery("");
      }}
    >
      <Popover.Trigger asChild>
        <ToolbarButton
          icon="branch"
          caption={t("picker.caption")}
          value={label}
          trailing={<Icon name="dropdown" size={12} />}
          aria-label={t("picker.label", { name: label })}
        />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className={styles.content} align="start" sideOffset={4}>
          <div className={styles.searchRow}>
            <input
              type="search"
              className={styles.search}
              placeholder={t("picker.search")}
              aria-label={t("picker.search")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                const first = local[0] ?? remote[0];
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  listRef.current?.querySelector<HTMLButtonElement>("[data-branch-item]")?.focus();
                } else if (e.key === "Enter" && !e.nativeEvent.isComposing && first) {
                  e.preventDefault();
                  choose(first);
                }
              }}
              autoFocus
            />
          </div>
          <div ref={listRef} className={styles.lists} onKeyDown={onListKeyDown}>
            {local.length === 0 && remote.length === 0 ? (
              <p className={styles.empty}>{t("picker.noMatches", { query: query.trim() })}</p>
            ) : (
              <>
                {local.length > 0 && (
                  <section aria-label={t("picker.local")}>
                    <h3 className={styles.section}>{t("picker.local")}</h3>
                    <ul className={styles.list}>{local.map(row)}</ul>
                  </section>
                )}
                {remote.length > 0 && (
                  <section aria-label={t("picker.remote")}>
                    <h3 className={styles.section}>{t("picker.remote")}</h3>
                    <ul className={styles.list}>{remote.map(row)}</ul>
                  </section>
                )}
              </>
            )}
          </div>
          <div className={styles.footer}>
            <Button
              variant="ghost"
              onClick={() => fromPicker(() => openDialog({ kind: "create" }))}
            >
              {t("picker.new")}
            </Button>
            {current && (
              <Button
                variant="ghost"
                onClick={() => fromPicker(() => openDialog({ kind: "merge" }))}
              >
                {t("picker.merge", { branch: current })}
              </Button>
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

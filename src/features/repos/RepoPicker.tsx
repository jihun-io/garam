import { ContextMenu, Popover } from "radix-ui";
import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "../../components/ui/Button";
import menu from "../../components/ui/Menu.module.css";
import type { RepositoryEntry } from "../../ipc";
import { displayPath } from "../../lib/paths";
import { useNotify } from "../notify/notifyStore";
import { useRepositoryActions } from "./api";
import { useRepoDialog } from "./dialogStore";
import styles from "./RepoPicker.module.css";
import { Icon } from "../../components/Icon";
import { ToolbarButton } from "../../components/ui/ToolbarButton";

export function RepoPicker({
  repositories,
  selected,
}: {
  repositories: RepositoryEntry[];
  selected: RepositoryEntry | null;
}) {
  const { t } = useTranslation("repos");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const listRef = useRef<HTMLUListElement>(null);
  const { select, remove } = useRepositoryActions();
  const openDialog = useRepoDialog((s) => s.open);
  const showError = useNotify((s) => s.showError);

  const matches = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    if (!q) return repositories;
    return repositories.filter(
      (r) => r.name.toLocaleLowerCase().includes(q) || r.path.toLocaleLowerCase().includes(q),
    );
  }, [query, repositories]);

  const choose = (repo: RepositoryEntry) => {
    setOpen(false);
    setQuery("");
    if (repo.path !== selected?.path) select.mutate(repo.path, { onError: showError });
  };

  const items = () =>
    Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>("[data-repo-item]") ?? []);

  // Arrow keys move between the search box and the list.
  const onListKeyDown = (e: KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const all = items();
    const index = all.indexOf(document.activeElement as HTMLButtonElement);
    const next = e.key === "ArrowDown" ? index + 1 : index - 1;
    all[Math.max(0, Math.min(all.length - 1, next))]?.focus();
  };

  const openFromPicker = (kind: "add" | "clone" | "create") => {
    setOpen(false);
    openDialog({ kind });
  };

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
          icon="repository"
          caption={t("picker.caption")}
          value={selected?.name ?? t("picker.placeholder")}
          trailing={<Icon name="dropdown" size={12} />}
          aria-label={selected ? t("picker.label", { name: selected.name }) : undefined}
        />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className={styles.content} align="start" sideOffset={4}>
          <div className={styles.search}>
            <input
              type="search"
              className={styles.searchInput}
              placeholder={t("picker.search")}
              aria-label={t("picker.search")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  items()[0]?.focus();
                } else if (e.key === "Enter" && !e.nativeEvent.isComposing && matches[0]) {
                  e.preventDefault();
                  choose(matches[0]);
                }
              }}
              autoFocus
            />
          </div>
          {matches.length === 0 ? (
            <p className={styles.empty}>{t("picker.noMatches", { query: query.trim() })}</p>
          ) : (
            <ul ref={listRef} className={styles.list} onKeyDown={onListKeyDown}>
              {matches.map((repo) => (
                <li key={repo.path}>
                  <ContextMenu.Root>
                    <ContextMenu.Trigger asChild>
                      <button
                        type="button"
                        data-repo-item
                        className={styles.item}
                        aria-current={repo.path === selected?.path ? "true" : undefined}
                        onClick={() => choose(repo)}
                        title={repo.path}
                      >
                        <span className={styles.itemName}>{repo.name}</span>
                        {repo.missing && (
                          <span className={styles.missing}>{t("picker.missing")}</span>
                        )}
                        <span className={styles.itemPath}>{displayPath(repo.path)}</span>
                      </button>
                    </ContextMenu.Trigger>
                    <ContextMenu.Portal>
                      <ContextMenu.Content className={menu.content}>
                        <ContextMenu.Item
                          className={menu.item}
                          onSelect={() => remove.mutate(repo.path, { onError: showError })}
                        >
                          {t("picker.remove")}
                        </ContextMenu.Item>
                      </ContextMenu.Content>
                    </ContextMenu.Portal>
                  </ContextMenu.Root>
                </li>
              ))}
            </ul>
          )}
          <div className={styles.footer}>
            <Button variant="ghost" onClick={() => openFromPicker("add")}>
              {t("actions.add")}
            </Button>
            <Button variant="ghost" onClick={() => openFromPicker("clone")}>
              {t("actions.clone")}
            </Button>
            <Button variant="ghost" onClick={() => openFromPicker("create")}>
              {t("actions.create")}
            </Button>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

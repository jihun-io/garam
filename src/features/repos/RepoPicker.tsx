import { Popover } from "radix-ui";
import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "../../components/ui/Button";
import { ContextMenu } from "../../components/ui/ContextMenu";
import type { RepositoryEntry } from "../../ipc";
import { displayPath } from "../../lib/paths";
import { useNotify } from "../notify/notifyStore";
import { useRepositoryActions } from "./api";
import { useRepoDialog } from "./dialogStore";
import { useOpenIn, useOpenRepository } from "./openRepository";
import styles from "./RepoPicker.module.css";
import { Icon } from "../../components/Icon";
import { shortcutFor, useCommand } from "../../lib/commands";
import { ToolbarButton } from "../../components/ui/ToolbarButton";
import { Tooltip } from "../../components/ui/Tooltip";

export function RepoPicker({
  repositories,
  selected,
}: {
  repositories: RepositoryEntry[];
  selected: RepositoryEntry | null;
}) {
  const { t } = useTranslation("repos");
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  useCommand("view.repositories", () => setOpen(true));
  const [query, setQuery] = useState("");
  const listRef = useRef<HTMLUListElement>(null);
  const { remove } = useRepositoryActions();
  const openRepository = useOpenRepository();
  const openIn = useOpenIn();
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
    if (repo.path !== selected?.path) void openRepository(repo.path);
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
    triggerRef.current?.focus({ preventScroll: true });
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
      <Tooltip content={t("picker.tooltip")} shortcut={shortcutFor("view.repositories")}>
        <Popover.Trigger asChild ref={triggerRef}>
          <ToolbarButton
            icon="repository"
            className={styles.trigger}
            caption={t("picker.caption")}
            value={selected?.name ?? t("picker.placeholder")}
            trailing={<Icon name="dropdown" size={12} />}
          />
        </Popover.Trigger>
      </Tooltip>
      <Popover.Portal>
        <Popover.Content
          onCloseAutoFocus={(event) => {
            // Closing this picker must not steal a newly opened dialog's focus.
            if (document.activeElement?.closest('[role="dialog"]')) event.preventDefault();
          }}
          className={styles.content}
          align="start"
          sideOffset={4}
          aria-label={t("picker.tooltip")}
        >
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
                  <ContextMenu
                    items={[
                      {
                        label: t("picker.openInNewWindow"),
                        disabled: repo.path === selected?.path,
                        action: () => {
                          setOpen(false);
                          setQuery("");
                          return openIn(repo.path, "new_window").catch(showError);
                        },
                      },
                      {
                        label: t("picker.remove"),
                        action: () => remove.mutate(repo.path, { onError: showError }),
                      },
                    ]}
                  >
                    <button
                      type="button"
                      data-repo-item
                      className={styles.item}
                      aria-current={repo.path === selected?.path ? "true" : undefined}
                      onClick={() => choose(repo)}
                    >
                      <span className={styles.itemName}>{repo.name}</span>
                      {repo.missing && (
                        <span className={styles.missing}>{t("picker.missing")}</span>
                      )}
                      <span className={styles.itemPath}>{displayPath(repo.path)}</span>
                    </button>
                  </ContextMenu>
                </li>
              ))}
            </ul>
          )}
          <div className={styles.footer}>
            <Button variant="ghost" icon="addRepository" onClick={() => openFromPicker("add")}>
              {t("actions.add")}
            </Button>
            <Button variant="ghost" icon="clone" onClick={() => openFromPicker("clone")}>
              {t("actions.clone")}
            </Button>
            <Button
              variant="ghost"
              icon="createRepository"
              onClick={() => openFromPicker("create")}
            >
              {t("actions.create")}
            </Button>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

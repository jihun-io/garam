import { useVirtualizer } from "@tanstack/react-virtual";
import { ContextMenu } from "radix-ui";
import { useEffect, useRef, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";

import { CheckMark } from "../../components/ui/Checkbox";
import menu from "../../components/ui/Menu.module.css";
import { commands, type FileChange } from "../../ipc";
import {
  isSelectAll,
  selectHow,
  type ListSelection,
  type SelectHow,
} from "../../lib/listSelection";
import { joinPath } from "../../lib/paths";
import { currentPlatform } from "../../lib/platform";
import { useNotify } from "../notify/notifyStore";
import { checkState, displayKind, splitPath } from "./fileState";
import styles from "./FileList.module.css";
import { Icon } from "../../components/Icon";
import { Tooltip } from "../../components/ui/Tooltip";

const ROW_HEIGHT = 28;

/**
 * Changed files. Several can be selected like in a file manager (click,
 * ⌘/Ctrl-click, Shift-click, Shift+arrows, ⌘A/Ctrl+A); Space, ⌘⌫ and the
 * context menu act on all of them.
 */
export function FileList({
  repo,
  files,
  selection,
  onSelect,
  onSelectAll,
  onMove,
  onToggle,
  onDiscard,
  onStash,
}: {
  repo: string;
  files: FileChange[];
  /** Nothing is selected while a stash is shown. */
  selection: ListSelection;
  onSelect: (path: string, how: SelectHow) => void;
  onSelectAll: () => void;
  onMove: (delta: number, extend: boolean) => void;
  /** Includes or excludes `files` together, the way the first one isn't. */
  onToggle: (files: FileChange[]) => void;
  onDiscard?: (files: FileChange[]) => void;
  onStash?: (files: FileChange[]) => void;
}) {
  const { t } = useTranslation("changes");
  const showError = useNotify((s) => s.showError);
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: files.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  });

  const selectedPaths = new Set(selection.keys);
  const selectedFiles = files.filter((f) => selectedPaths.has(f.path));
  const focusIndex = files.findIndex((f) => f.path === selection.focus);

  useEffect(() => {
    if (focusIndex >= 0) virtualizer.scrollToIndex(focusIndex, { align: "auto" });
  }, [focusIndex, virtualizer]);

  // Conflicted files are resolved with the conflict actions, never ticked.
  const toggleable = selectedFiles.filter((f) => f.staged !== "conflicted");

  // Arrow keys move the selection (Shift extends it); Space includes or
  // excludes the selected files; ⌘⌫ / Ctrl+Backspace asks to discard them.
  const onKeyDown = (e: KeyboardEvent) => {
    if (files.length === 0) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      onMove(e.key === "ArrowDown" ? 1 : -1, e.shiftKey);
    } else if (isSelectAll(e)) {
      e.preventDefault();
      onSelectAll();
    } else if (
      (e.key === "Backspace" || e.key === "Delete") &&
      (e.metaKey || e.ctrlKey) &&
      selectedFiles.length > 0 &&
      onDiscard
    ) {
      // Opens the confirmation; nothing is discarded without it.
      e.preventDefault();
      onDiscard(selectedFiles);
    } else if (e.key === " " && toggleable.length > 0) {
      e.preventDefault();
      onToggle(toggleable);
    }
  };

  // A right click on a selected file acts on the whole selection.
  const menuTargets = (file: FileChange) => (selectedPaths.has(file.path) ? selectedFiles : [file]);

  return (
    <div
      ref={scrollRef}
      className={styles.scroll}
      role="listbox"
      aria-label={t("list.title", { count: files.length })}
      aria-multiselectable
      aria-activedescendant={focusIndex >= 0 ? `file-${focusIndex}` : undefined}
      tabIndex={0}
      onKeyDown={onKeyDown}
    >
      <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
        {virtualizer.getVirtualItems().map((item) => {
          const file = files[item.index];
          const kind = displayKind(file);
          const state = checkState(file);
          const { dir, name } = splitPath(file.path);
          const selected = selectedPaths.has(file.path);
          const targets = menuTargets(file);
          const several = targets.length > 1;
          return (
            <ContextMenu.Root key={file.path}>
              <ContextMenu.Trigger asChild>
                <div
                  id={`file-${item.index}`}
                  role="option"
                  aria-selected={selected}
                  // The row reports inclusion itself (Space toggles it); the
                  // box inside is only for the mouse, so it isn't a control
                  // nested in an option for screen readers.
                  aria-checked={state === "mixed" ? "mixed" : state === "checked"}
                  className={styles.row}
                  style={{ transform: `translateY(${item.start}px)`, height: ROW_HEIGHT }}
                  onMouseDown={(e) => {
                    // A right click keeps a selection it lands in, so the
                    // menu acts on all of it.
                    if (e.button !== 0) {
                      if (!selected) onSelect(file.path, "single");
                      return;
                    }
                    const how = selectHow(e);
                    // Shift-click would also select the text in between.
                    if (how === "range") e.preventDefault();
                    onSelect(file.path, how);
                  }}
                >
                  <CheckMark
                    state={state}
                    disabled={kind === "conflicted"}
                    onToggle={() => onToggle([file])}
                  />
                  <Tooltip
                    content={file.origPath ? `${file.origPath} → ${file.path}` : file.path}
                    whenTruncated
                  >
                    <span className={styles.path}>
                      {dir && <span className={styles.dir}>{dir}</span>}
                      <span className={styles.name}>{name}</span>
                    </span>
                  </Tooltip>
                  <Tooltip content={t(`kind.${kind}`)} side="right">
                    <span className={`${styles.kind} ${styles[kind]}`}>
                      <Icon name={kind} label={t(`kind.${kind}`)} />
                    </span>
                  </Tooltip>
                </div>
              </ContextMenu.Trigger>
              <ContextMenu.Portal>
                <ContextMenu.Content className={menu.content}>
                  {onDiscard && (
                    <ContextMenu.Item className={menu.item} onSelect={() => onDiscard(targets)}>
                      {several
                        ? t("fileMenu.discardSelected", { count: targets.length })
                        : t("fileMenu.discard")}
                    </ContextMenu.Item>
                  )}
                  {onStash && (
                    <ContextMenu.Item
                      className={menu.item}
                      disabled={targets.some((f) => f.staged === "conflicted")}
                      onSelect={() => onStash(targets)}
                    >
                      {several
                        ? t("fileMenu.stashSelected", { count: targets.length })
                        : t("fileMenu.stash")}
                    </ContextMenu.Item>
                  )}
                  {(onDiscard || onStash) && <ContextMenu.Separator className={menu.separator} />}
                  <ContextMenu.Item
                    className={menu.item}
                    onSelect={() =>
                      void navigator.clipboard.writeText(targets.map((f) => f.path).join("\n"))
                    }
                  >
                    {several
                      ? t("fileMenu.copyPaths", { count: targets.length })
                      : t("fileMenu.copyPath")}
                  </ContextMenu.Item>
                  <ContextMenu.Item
                    className={menu.item}
                    disabled={several || kind === "deleted"}
                    onSelect={() =>
                      void commands
                        .externalReveal(joinPath(repo, file.path))
                        .then((r) => r.status === "error" && showError(r.error))
                    }
                  >
                    {t(`fileMenu.reveal_${currentPlatform()}`)}
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

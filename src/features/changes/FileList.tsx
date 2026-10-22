import { useVirtualizer } from "@tanstack/react-virtual";
import { ContextMenu } from "radix-ui";
import { useEffect, useRef, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";

import { Checkbox } from "../../components/ui/Checkbox";
import menu from "../../components/ui/Menu.module.css";
import { commands, type FileChange } from "../../ipc";
import { joinPath } from "../../lib/paths";
import { currentPlatform } from "../../lib/platform";
import { useNotify } from "../notify/notifyStore";
import { checkState, displayKind, splitPath } from "./fileState";
import styles from "./FileList.module.css";
import { Icon } from "../../components/Icon";
import { Tooltip } from "../../components/ui/Tooltip";

const ROW_HEIGHT = 28;

export function FileList({
  repo,
  files,
  selectedPath,
  onSelect,
  onToggle,
  onDiscard,
}: {
  repo: string;
  files: FileChange[];
  selectedPath: string | null;
  onSelect: (path: string) => void;
  onToggle: (file: FileChange) => void;
  onDiscard: (files: FileChange[]) => void;
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

  const selectedIndex = files.findIndex((f) => f.path === selectedPath);

  useEffect(() => {
    if (selectedIndex >= 0) virtualizer.scrollToIndex(selectedIndex, { align: "auto" });
  }, [selectedIndex, virtualizer]);

  // Arrow keys move the selection; Space toggles inclusion in the commit;
  // ⌘⌫ / Ctrl+Backspace asks to discard the selected file's changes.
  const onKeyDown = (e: KeyboardEvent) => {
    if (files.length === 0) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const delta = e.key === "ArrowDown" ? 1 : -1;
      const next = Math.max(0, Math.min(files.length - 1, selectedIndex + delta));
      onSelect(files[next].path);
    } else if (
      (e.key === "Backspace" || e.key === "Delete") &&
      (e.metaKey || e.ctrlKey) &&
      selectedIndex >= 0
    ) {
      // Opens the confirmation; nothing is discarded without it.
      e.preventDefault();
      onDiscard([files[selectedIndex]]);
    } else if (
      e.key === " " &&
      selectedIndex >= 0 &&
      files[selectedIndex].staged !== "conflicted"
    ) {
      e.preventDefault();
      onToggle(files[selectedIndex]);
    }
  };

  return (
    <div
      ref={scrollRef}
      className={styles.scroll}
      role="listbox"
      aria-label={t("list.title", { count: files.length })}
      aria-activedescendant={selectedIndex >= 0 ? `file-${selectedIndex}` : undefined}
      tabIndex={0}
      onKeyDown={onKeyDown}
    >
      <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
        {virtualizer.getVirtualItems().map((item) => {
          const file = files[item.index];
          const kind = displayKind(file);
          const { dir, name } = splitPath(file.path);
          const selected = file.path === selectedPath;
          return (
            <ContextMenu.Root key={file.path}>
              <ContextMenu.Trigger asChild>
                <div
                  id={`file-${item.index}`}
                  role="option"
                  aria-selected={selected}
                  className={styles.row}
                  style={{ transform: `translateY(${item.start}px)`, height: ROW_HEIGHT }}
                  onMouseDown={() => onSelect(file.path)}
                >
                  <Checkbox
                    state={checkState(file)}
                    disabled={kind === "conflicted"}
                    tabIndex={-1}
                    aria-label={t("list.include", { path: file.path })}
                    onChange={() => onToggle(file)}
                    onMouseDown={(e) => e.stopPropagation()}
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
                  <ContextMenu.Item className={menu.item} onSelect={() => onDiscard([file])}>
                    {t("fileMenu.discard")}
                  </ContextMenu.Item>
                  <ContextMenu.Separator className={menu.separator} />
                  <ContextMenu.Item
                    className={menu.item}
                    onSelect={() => void navigator.clipboard.writeText(file.path)}
                  >
                    {t("fileMenu.copyPath")}
                  </ContextMenu.Item>
                  <ContextMenu.Item
                    className={menu.item}
                    disabled={kind === "deleted"}
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

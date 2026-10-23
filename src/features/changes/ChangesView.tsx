import { DropdownMenu } from "radix-ui";
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { EmptyMessage } from "../../components/EmptyMessage";
import { ErrorMessage } from "../../components/ErrorMessage";
import { Checkbox } from "../../components/ui/Checkbox";
import { Loading } from "../../components/ui/Loading";
import menu from "../../components/ui/Menu.module.css";
import { toAppError, type FileChange } from "../../ipc";
import { AutoStashBanner } from "../branches/AutoStashBanner";
import { useConflicts } from "../conflicts/api";
import { ConflictBanner, ConflictPanel } from "../conflicts/ConflictPanel";
import { CommandList } from "../menu/CommandList";
import { useNotify } from "../notify/notifyStore";
import { SidebarSplitter } from "../settings/SidebarSplitter";
import { useStashes } from "../stashes/api";
import { StashConflictBanner } from "../stashes/StashConflictBanner";
import { StashDetail } from "../stashes/StashDetail";
import { StashDialog } from "../stashes/StashDialog";
import { StashSection } from "../stashes/StashSection";
import { useCommand } from "../../lib/commands";
import {
  NO_SELECTION,
  move,
  reconcile,
  select,
  selectAll,
  type ListSelection,
} from "../../lib/listSelection";
import { SelectedFiles } from "./SelectedFiles";
import { useChangeActions, useStatus } from "./api";
import styles from "./ChangesView.module.css";
import { CommitForm } from "./CommitForm";
import { DiffView } from "./DiffView";
import { DiscardDialog } from "./DiscardDialog";
import { FileList } from "./FileList";
import { checkState, combinedCheckState } from "./fileState";
import { Icon } from "../../components/Icon";
import { Tooltip } from "../../components/ui/Tooltip";

/**
 * Changed files, the selected file's diff, and the commit form, with the
 * stashes below the files. `tabs` is shown at the top of the sidebar.
 */
export function ChangesView({ repo, tabs }: { repo: string; tabs?: ReactNode }) {
  const { t } = useTranslation("changes");
  const status = useStatus(repo);
  const conflicts = useConflicts(repo);
  const stashes = useStashes(repo).data ?? [];
  const { stage, unstage } = useChangeActions(repo);
  const showError = useNotify((s) => s.showError);
  const [rawSelection, setSelection] = useState<ListSelection>(NO_SELECTION);
  const [selectedStash, setSelectedStash] = useState<string | null>(null);
  const [discarding, setDiscarding] = useState<FileChange[] | null>(null);
  // Paths to stash; empty means all changes.
  const [stashing, setStashing] = useState<string[] | null>(null);
  const hasFiles = (status.data?.files.length ?? 0) > 0;
  useCommand("repo.stash", () => setStashing([]), hasFiles);

  if (status.isError) {
    return (
      <div className={styles.error}>
        <ErrorMessage error={toAppError(status.error)} />
      </div>
    );
  }
  if (!status.data) {
    return (
      <div className={styles.root}>
        <aside className={styles.sidebar}>{tabs}</aside>
        <div className={styles.main}>
          <Loading />
        </div>
      </div>
    );
  }

  const { files, branch } = status.data;
  // Keep a selection whenever there are files; fall back to the first.
  const order = files.map((f) => f.path);
  const selection = reconcile(order, rawSelection);
  const selectedFiles = files.filter((f) => selection.keys.includes(f.path));
  const selected = selectedFiles.length === 1 ? selectedFiles[0] : null;
  const stagedCount = files.filter((f) => checkState(f) !== "unchecked").length;
  const allState = combinedCheckState(files.filter((f) => f.staged !== "conflicted"));

  // Conflicted files are resolved with the conflict actions, never by
  // ticking them, which would mark them resolved with markers left in.
  const toggleable = files.filter((f) => f.staged !== "conflicted");
  const toggle = (targets: FileChange[], include: boolean) => {
    const action = include ? stage : unstage;
    const allowed = targets.filter((f) => f.staged !== "conflicted");
    if (allowed.length > 0) action.mutate(allowed, { onError: showError });
  };
  const operation = conflicts.data?.operation ?? null;
  // Falls back to the files once the stash is popped or dropped.
  const stash = stashes.find((s) => s.oid === selectedStash) ?? null;
  const showFiles = (next: ListSelection) => {
    setSelection(next);
    setSelectedStash(null);
  };
  // Includes them all unless they all are already.
  const toggleTogether = (targets: FileChange[]) =>
    toggle(targets, !targets.every((f) => checkState(f) === "checked"));

  return (
    <div className={styles.root}>
      <aside className={styles.sidebar}>
        {tabs}
        <AutoStashBanner repo={repo} branch={branch.head} />
        {conflicts.data && <ConflictBanner state={conflicts.data} />}
        <StashConflictBanner repo={repo} conflicts={conflicts.data} />
        <div className={styles.listHeader}>
          <Checkbox
            state={allState}
            disabled={toggleable.length === 0}
            aria-label={t("list.selectAll")}
            onChange={() => toggle(toggleable, allState !== "checked")}
          />
          <span className={styles.listTitle}>{t("list.title", { count: files.length })}</span>
          <DropdownMenu.Root>
            <Tooltip content={t("list.more")}>
              <DropdownMenu.Trigger asChild disabled={files.length === 0}>
                <button type="button" className={styles.more} aria-label={t("list.more")}>
                  <Icon name="more" size={20} />
                </button>
              </DropdownMenu.Trigger>
            </Tooltip>
            <DropdownMenu.Portal>
              <DropdownMenu.Content className={menu.content} align="end" sideOffset={4}>
                <DropdownMenu.Item className={menu.item} onSelect={() => setStashing([])}>
                  {t("list.stashAll")}
                </DropdownMenu.Item>
                <DropdownMenu.Item className={menu.item} onSelect={() => setDiscarding(files)}>
                  {t("list.discardAll")}
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </div>
        {files.length > 0 ? (
          <FileList
            repo={repo}
            files={files}
            selection={stash ? NO_SELECTION : selection}
            onSelect={(path, how) => showFiles(select(order, selection, path, how))}
            onSelectAll={() => showFiles(selectAll(order, selection))}
            onMove={(delta, extend) => showFiles(move(order, selection, delta, extend))}
            onToggle={toggleTogether}
            onDiscard={setDiscarding}
            onStash={(targets) => setStashing(targets.map((f) => f.path))}
          />
        ) : (
          <div className={styles.listEmpty} />
        )}
        <StashSection stashes={stashes} selected={stash?.oid ?? null} onSelect={setSelectedStash} />
        <SidebarSplitter />
        {operation && conflicts.data ? (
          <ConflictPanel repo={repo} state={conflicts.data} />
        ) : (
          <CommitForm repo={repo} branch={branch} stagedCount={stagedCount} />
        )}
      </aside>

      <div className={styles.main}>
        {stash ? (
          <StashDetail key={stash.oid} repo={repo} stash={stash} />
        ) : selectedFiles.length > 1 ? (
          <SelectedFiles
            files={selectedFiles}
            onToggle={toggleTogether}
            onStash={() => setStashing(selectedFiles.map((f) => f.path))}
            onDiscard={() => setDiscarding(selectedFiles)}
          />
        ) : files.length > 0 ? (
          <DiffView
            repo={repo}
            file={selected}
            conflict={conflicts.data?.files.find((f) => f.path === selected?.path)}
          />
        ) : (
          <EmptyMessage icon="success" title={t("empty.title")} body={t("empty.body")}>
            <CommandList ids={["repo.openEditor", "repo.openTerminal", "repo.reveal"]} />
          </EmptyMessage>
        )}
      </div>

      {discarding && (
        <DiscardDialog repo={repo} files={discarding} onClose={() => setDiscarding(null)} />
      )}
      {stashing && <StashDialog repo={repo} paths={stashing} onClose={() => setStashing(null)} />}
    </div>
  );
}

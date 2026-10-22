import { DropdownMenu } from "radix-ui";
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { ErrorMessage } from "../../components/ErrorMessage";
import { Checkbox } from "../../components/ui/Checkbox";
import menu from "../../components/ui/Menu.module.css";
import { toAppError, type FileChange } from "../../ipc";
import { AutoStashBanner } from "../branches/AutoStashBanner";
import { useConflicts } from "../conflicts/api";
import { ConflictBanner, ConflictPanel } from "../conflicts/ConflictPanel";
import { useNotify } from "../notify/notifyStore";
import { useChangeActions, useStatus } from "./api";
import styles from "./ChangesView.module.css";
import { CommitForm } from "./CommitForm";
import { DiffView } from "./DiffView";
import { DiscardDialog } from "./DiscardDialog";
import { FileList } from "./FileList";
import { checkState, combinedCheckState } from "./fileState";

/**
 * Changed files, the selected file's diff, and the commit form. `tabs` is
 * shown at the top of the sidebar.
 */
export function ChangesView({ repo, tabs }: { repo: string; tabs?: ReactNode }) {
  const { t } = useTranslation("changes");
  const status = useStatus(repo);
  const conflicts = useConflicts(repo);
  const { stage, unstage } = useChangeActions(repo);
  const showError = useNotify((s) => s.showError);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [discarding, setDiscarding] = useState<FileChange[] | null>(null);

  if (status.isError) {
    return (
      <div className={styles.error}>
        <ErrorMessage error={toAppError(status.error)} />
      </div>
    );
  }
  if (!status.data) return null;

  const { files, branch } = status.data;
  // Keep a selection whenever there are files; fall back to the first.
  const selected = files.find((f) => f.path === selectedPath) ?? files[0] ?? null;
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

  return (
    <div className={styles.root}>
      <aside className={styles.sidebar}>
        {tabs}
        <AutoStashBanner repo={repo} branch={branch.head} />
        {conflicts.data && <ConflictBanner state={conflicts.data} />}
        <div className={styles.listHeader}>
          <Checkbox
            state={allState}
            disabled={toggleable.length === 0}
            aria-label={t("list.selectAll")}
            onChange={() => toggle(toggleable, allState !== "checked")}
          />
          <span className={styles.listTitle}>{t("list.title", { count: files.length })}</span>
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild disabled={files.length === 0}>
              <button type="button" className={styles.more} aria-label={t("list.discardAll")}>
                ⋯
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content className={menu.content} align="end" sideOffset={4}>
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
            selectedPath={selected?.path ?? null}
            onSelect={setSelectedPath}
            onToggle={(file) => toggle([file], checkState(file) !== "checked")}
            onDiscard={setDiscarding}
          />
        ) : (
          <div className={styles.listEmpty} />
        )}
        {operation && conflicts.data ? (
          <ConflictPanel repo={repo} state={conflicts.data} />
        ) : (
          <CommitForm repo={repo} branch={branch} stagedCount={stagedCount} />
        )}
      </aside>

      <div className={styles.main}>
        {files.length > 0 ? (
          <DiffView
            repo={repo}
            file={selected}
            conflict={conflicts.data?.files.find((f) => f.path === selected?.path)}
          />
        ) : (
          <div className={styles.empty}>
            <h2 className={styles.emptyTitle}>{t("empty.title")}</h2>
            <p className={styles.emptyBody}>{t("empty.body")}</p>
          </div>
        )}
      </div>

      {discarding && (
        <DiscardDialog repo={repo} files={discarding} onClose={() => setDiscarding(null)} />
      )}
    </div>
  );
}

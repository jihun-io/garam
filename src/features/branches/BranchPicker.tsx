import { ContextMenu, Popover } from "radix-ui";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "../../components/ui/Button";
import menu from "../../components/ui/Menu.module.css";
import type { Branch, BranchStatus } from "../../ipc";
import { useRelativeTime } from "../../lib/time";
import { dropTarget, useCommitDrag } from "../history/commitDragStore";
import { useHistoryPane } from "../history/historyPaneStore";
import { refName, useBranches, useCleanupCandidates } from "./api";
import { useBranchDialog } from "./branchDialogStore";
import { CommitCounts } from "./CommitCounts";
import styles from "./branches.module.css";
import { Icon } from "../../components/Icon";
import { runCommand, shortcutFor, useCommand } from "../../lib/commands";
import { ToolbarButton } from "../../components/ui/ToolbarButton";
import { Tooltip } from "../../components/ui/Tooltip";
import { useNotify } from "../notify/notifyStore";
import { canOpenFor, useDefaultRemote } from "../pullRequests/PullRequestControls";
import { supportsPullRequests, usePullRequestContext } from "../pullRequests/api";
import { usePullRequestDialog } from "../pullRequests/pullRequestDialogStore";
import { PullRequestTag, useBranchPullRequests } from "../pullRequests/PullRequestStatus";
import { openUrl } from "@tauri-apps/plugin-opener";

/** How long dragged commits hover over the button before the list opens. */
const OPEN_ON_DRAG_MS = 400;

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
  const { t } = useTranslation("branches");
  const relativeTime = useRelativeTime();
  const branches = useBranches(repo);
  const openDialog = useBranchDialog((s) => s.open);
  const openPullRequestDialog = usePullRequestDialog((s) => s.open);
  const pullRequests = useBranchPullRequests(repo, status);
  const prSupported = supportsPullRequests(usePullRequestContext(repo).data);
  const defaultRemote = useDefaultRemote(repo);
  const showError = useNotify((s) => s.showError);
  const showPane = useHistoryPane((s) => s.show);
  const [open, setOpen] = useState(false);
  useCommand("view.branches", () => setOpen(true));
  // Looked up while the list is open, for the footer's "n to clean up".
  const cleanupCount = useCleanupCandidates(repo, open).data?.length ?? 0;
  const dragging = useCommitDrag((s) => s.drag !== null);
  // The branch under the dragged commits; `:hover` doesn't follow a drag
  // that began elsewhere in every web view.
  const dropOver = useCommitDrag((s) => s.drag?.over ?? null);
  const hover = useRef<number | undefined>(undefined);
  const openedByDrag = useRef(false);
  // A list opened for a drop closes when the drag ends, dropped or not.
  useEffect(() => {
    if (dragging || !openedByDrag.current) return;
    openedByDrag.current = false;
    setOpen(false);
  }, [dragging]);
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

  /** Shows what `branch` changed since it split from the current one. */
  const compareWithCurrent = (branch: Branch) => {
    if (!status.oid) return;
    showPane(repo, {
      kind: "compare",
      base: current ? `refs/heads/${current}` : status.oid,
      target: refName(branch),
      mode: "three_dot",
      baseLabel: current ?? t("picker.detached"),
      targetLabel: branch.name,
    });
    runCommand("view.history");
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
        <ContextMenu.Trigger asChild>
          <button
            type="button"
            data-branch-item
            {...(branch.kind === "local" ? dropTarget(branch.name) : {})}
            data-drop-over={(branch.kind === "local" && dropOver === branch.name) || undefined}
            className={styles.item}
            aria-current={branch.isHead ? "true" : undefined}
            onClick={() => choose(branch)}
          >
            <span className={styles.itemName}>{branch.name}</span>
            <span className={styles.itemMeta}>
              {branch.kind === "local" && pullRequests.has(branch.name) && (
                <PullRequestTag pr={pullRequests.get(branch.name)!} />
              )}
              {branch.upstreamGone && <span className={styles.gone}>{t("picker.gone")}</span>}
              <CommitCounts ahead={branch.ahead} behind={branch.behind} />
              <span>{relativeTime(branch.committedAt)}</span>
            </span>
          </button>
        </ContextMenu.Trigger>
        <ContextMenu.Portal>
          <ContextMenu.Content className={menu.content}>
            {!branch.isHead && status.oid && (
              <ContextMenu.Item
                className={menu.item}
                onSelect={() => fromPicker(() => compareWithCurrent(branch))}
              >
                {t("picker.compareThis", { branch: current ?? t("picker.detached") })}
              </ContextMenu.Item>
            )}
            {branch.kind === "local" && (
              <>
                <ContextMenu.Separator className={menu.separator} />
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
                {pullRequests.has(branch.name) ? (
                  <ContextMenu.Item
                    className={menu.item}
                    onSelect={() =>
                      fromPicker(
                        () => void openUrl(pullRequests.get(branch.name)!.url).catch(showError),
                      )
                    }
                  >
                    {t("picker.viewPullRequest", { number: pullRequests.get(branch.name)!.number })}
                  </ContextMenu.Item>
                ) : (
                  prSupported &&
                  canOpenFor(branch, defaultRemote) && (
                    <ContextMenu.Item
                      className={menu.item}
                      onSelect={() => fromPicker(() => openPullRequestDialog(branch.name))}
                    >
                      {t("picker.createPullRequest")}
                    </ContextMenu.Item>
                  )
                )}
                <ContextMenu.Separator className={menu.separator} />
                <ContextMenu.Item
                  className={menu.item}
                  disabled={branch.isHead}
                  onSelect={() => fromPicker(() => openDialog({ kind: "delete", branch }))}
                >
                  {t("picker.delete")}
                </ContextMenu.Item>
              </>
            )}
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
      <Tooltip content={t("picker.tooltip")} shortcut={shortcutFor("view.branches")}>
        <Popover.Trigger asChild>
          <ToolbarButton
            {...(current ? dropTarget(current) : {})}
            data-drop-over={(current !== null && dropOver === current) || undefined}
            onMouseEnter={() => {
              // Hovering with dragged commits opens the list to drop them on.
              if (!useCommitDrag.getState().drag) return;
              hover.current = window.setTimeout(() => {
                openedByDrag.current = true;
                setOpen(true);
              }, OPEN_ON_DRAG_MS);
            }}
            onMouseLeave={() => window.clearTimeout(hover.current)}
            icon="branch"
            caption={t("picker.caption")}
            value={label}
            trailing={<Icon name="dropdown" size={12} />}
          />
        </Popover.Trigger>
      </Tooltip>
      <Popover.Portal>
        <Popover.Content
          className={styles.content}
          align="start"
          sideOffset={4}
          aria-label={t("picker.tooltip")}
        >
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
            <Button variant="ghost" onClick={() => fromPicker(() => runCommand("branch.compare"))}>
              {t("picker.compare")}
            </Button>
            {cleanupCount > 0 && (
              <Button
                variant="ghost"
                onClick={() => fromPicker(() => openDialog({ kind: "cleanup" }))}
              >
                {t("picker.cleanup", { count: cleanupCount })}
              </Button>
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

import { DropdownMenu } from "radix-ui";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import menu from "../../components/ui/Menu.module.css";
import { toAppError } from "../../ipc";
import { shortcutFor, useCommand } from "../../lib/commands";
import { relativeTime } from "../../lib/time";
import { useBranches } from "../branches/api";
import { CommitCounts } from "../branches/CommitCounts";
import { useStatus } from "../changes/api";
import { useNotify } from "../notify/notifyStore";
import { useSettings } from "../settings/api";
import { useRemoteInfo, useSyncActions, type SyncResult } from "./api";
import { hasUpstream, primaryAction } from "./primaryAction";
import styles from "./SyncButton.module.css";
import { useSyncStore, type SyncAction } from "./syncStore";
import { useBackgroundFetch } from "./useBackgroundFetch";
import { Icon } from "../../components/Icon";
import { ToolbarButton } from "../../components/ui/ToolbarButton";
import { Tooltip } from "../../components/ui/Tooltip";

/** Re-renders every `ms` so relative times stay current. */
function useTick(ms: number) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((n) => n + 1), ms);
    return () => clearInterval(timer);
  }, [ms]);
}

/**
 * The toolbar's one sync button: fetch, pull, push or publish depending on
 * the branch, plus a menu for the others. Hidden without remotes.
 */
export function SyncButton({ repo }: { repo: string }) {
  const { t, i18n } = useTranslation("sync");
  const status = useStatus(repo);
  const info = useRemoteInfo(repo);
  const branches = useBranches(repo);
  const running = useSyncStore((s) => s.running[repo]);
  const { run, cancel } = useSyncActions(repo);
  const { showError, showInfo } = useNotify();
  const remote = info.data?.defaultRemote ?? null;
  const { fetchIntervalMinutes } = useSettings();
  useBackgroundFetch(repo, remote, fetchIntervalMinutes);
  useTick(60 * 1000);

  const branch = status.data?.branch;
  const ready = !!branch && !!info.data && info.data.remotes.length > 0;
  const upstreamGone =
    branches.data?.some((b) => b.kind === "local" && b.isHead && b.upstreamGone) ?? false;
  const primary = branch ? primaryAction(branch, upstreamGone) : null;
  const tracked = branch ? hasUpstream(branch, upstreamGone) : false;
  const upstream = branch?.upstream ?? "";
  const head = branch?.head ?? "";
  const busy = running !== undefined;

  const start = (action: SyncAction) => {
    run({ action, remote })
      .then((result) => result && announce(action, result))
      .catch((e: unknown) => {
        if (toAppError(e).kind !== "cancelled") showError(e);
      });
  };

  const announce = (action: SyncAction, result: SyncResult) => {
    if (action === "pull") {
      showInfo(
        result === "up_to_date"
          ? t("done.upToDate", { branch: head })
          : t("done.pulled", { upstream }),
      );
    } else if (action === "push") {
      showInfo(t("done.pushed", { upstream }));
    } else if (action === "publish") {
      showInfo(t("done.published", { branch: head, remote: remote ?? "" }));
    }
  };

  // Push publishes a branch that isn't on the remote yet.
  const canPublish = primary?.action === "publish" && !primary.disabled;
  useCommand("sync.fetch", () => start("fetch"), ready && !busy && !!remote);
  useCommand("sync.pull", () => start("pull"), ready && !busy && tracked);
  useCommand(
    "sync.push",
    () => start(tracked ? "push" : "publish"),
    ready && !busy && (tracked ? (branch?.ahead ?? 0) > 0 : canPublish),
  );

  if (!ready || !branch || !primary || !info.data) return null;
  const primaryShortcut = shortcutFor(
    primary.action === "fetch"
      ? "sync.fetch"
      : primary.action === "pull"
        ? "sync.pull"
        : "sync.push",
  );
  const shown = running?.action ?? primary.action;
  const percent = running?.progress?.overallPercent ?? 0;
  const label = running
    ? t(`running.${running.action}`)
    : primary.action === "publish"
      ? t("action.publish")
      : t(`action.${primary.action}`, { remote: remote ?? "" });
  const detail =
    primary.action === "publish" && !running
      ? primary.disabled
        ? t("unbornHint")
        : t("publishHint", { remote: remote ?? "" })
      : info.data.lastFetchedAt
        ? t("lastFetched", { time: relativeTime(info.data.lastFetchedAt, i18n.language) })
        : t("neverFetched");

  return (
    <div className={styles.root}>
      <Tooltip content={label} shortcut={primaryShortcut}>
        <ToolbarButton
          icon={shown}
          value={label}
          caption={detail}
          captionBelow
          className={styles.main}
          progress={busy ? percent : undefined}
          disabled={busy || (primary.action === "publish" && primary.disabled)}
          aria-busy={busy}
          onClick={() => start(primary.action)}
          trailing={
            <>
              {busy && (
                <span
                  className="sr-only"
                  role="progressbar"
                  aria-label={label}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={percent}
                />
              )}
              {tracked && <CommitCounts ahead={branch.ahead} behind={branch.behind} />}
            </>
          }
        />
      </Tooltip>
      {busy ? (
        <Tooltip content={t("cancel")}>
          <button type="button" className={styles.side} onClick={cancel} aria-label={t("cancel")}>
            <Icon name="close" size={14} />
          </button>
        </Tooltip>
      ) : (
        <DropdownMenu.Root>
          <Tooltip content={t("more")}>
            <DropdownMenu.Trigger asChild>
              <button type="button" className={styles.side} aria-label={t("more")}>
                <Icon name="dropdown" size={12} />
              </button>
            </DropdownMenu.Trigger>
          </Tooltip>
          <DropdownMenu.Portal>
            <DropdownMenu.Content className={menu.content} align="end" sideOffset={4}>
              <DropdownMenu.Item
                className={menu.item}
                disabled={!remote}
                onSelect={() => start("fetch")}
              >
                {t("menu.fetch")}
              </DropdownMenu.Item>
              <DropdownMenu.Item
                className={menu.item}
                disabled={!tracked}
                onSelect={() => start("pull")}
              >
                {t("menu.pull")}
              </DropdownMenu.Item>
              <DropdownMenu.Item
                className={menu.item}
                disabled={!tracked || branch.ahead === 0}
                onSelect={() => start("push")}
              >
                {t("menu.push")}
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      )}
    </div>
  );
}

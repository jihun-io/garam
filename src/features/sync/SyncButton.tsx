import { DropdownMenu } from "radix-ui";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import menu from "../../components/ui/Menu.module.css";
import { toAppError } from "../../ipc";
import { relativeTime } from "../../lib/time";
import { useBranches } from "../branches/api";
import { CommitCounts } from "../branches/CommitCounts";
import { useStatus } from "../changes/api";
import { useNotify } from "../notify/notifyStore";
import { useRemoteInfo, useSyncActions, type SyncResult } from "./api";
import { hasUpstream, primaryAction } from "./primaryAction";
import styles from "./SyncButton.module.css";
import { useSyncStore, type SyncAction } from "./syncStore";
import { useBackgroundFetch } from "./useBackgroundFetch";
import { Icon } from "../../components/Icon";
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
  useBackgroundFetch(repo, remote);
  useTick(60 * 1000);

  if (!status.data || !info.data || info.data.remotes.length === 0) return null;
  const branch = status.data.branch;
  const upstreamGone =
    branches.data?.some((b) => b.kind === "local" && b.isHead && b.upstreamGone) ?? false;
  const primary = primaryAction(branch, upstreamGone);
  const tracked = hasUpstream(branch, upstreamGone);
  const upstream = branch.upstream ?? "";
  const head = branch.head ?? "";
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
      <button
        type="button"
        className={styles.button}
        disabled={busy || (primary.action === "publish" && primary.disabled)}
        aria-busy={busy}
        onClick={() => start(primary.action)}
      >
        {busy && (
          <span
            className={styles.fill}
            style={{ width: `${percent}%` }}
            role="progressbar"
            aria-label={label}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
          />
        )}
        <Icon name={shown} className={styles.icon} />
        <span className={styles.text}>
          <span className={styles.label}>{label}</span>
          <span className={styles.detail}>{detail}</span>
        </span>
        {tracked && (
          <span className={styles.counts}>
            <CommitCounts ahead={branch.ahead} behind={branch.behind} />
          </span>
        )}
      </button>
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

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

import type { RemoteInfo } from "../../ipc";
import { runSync, syncKeys } from "./api";

const CHECK_EVERY_MS = 60 * 1000;

/**
 * Fetches `remote` quietly whenever the last fetch (or attempt) is older
 * than `intervalMinutes` (0 turns it off). Never prompts for credentials;
 * failures are ignored.
 */
export function useBackgroundFetch(repo: string, remote: string | null, intervalMinutes: number) {
  const client = useQueryClient();
  // A failed fetch doesn't update FETCH_HEAD, so remember attempts too.
  const lastAttempt = useRef(0);

  useEffect(() => {
    if (!remote || intervalMinutes <= 0) return;
    const intervalSeconds = intervalMinutes * 60;
    const tick = () => {
      const fetchedAt = client.getQueryData<RemoteInfo>(syncKeys.info(repo))?.lastFetchedAt ?? 0;
      const now = Date.now() / 1000;
      if (now - Math.max(fetchedAt, lastAttempt.current) < intervalSeconds) return;
      lastAttempt.current = now;
      void runSync(client, repo, { action: "fetch", remote, background: true }).catch(() => {});
    };
    tick();
    const timer = setInterval(tick, CHECK_EVERY_MS);
    return () => clearInterval(timer);
  }, [client, repo, remote, intervalMinutes]);
}

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

import type { RemoteInfo } from "../../ipc";
import { runSync, syncKeys } from "./api";

// TODO(M8): make the interval a setting.
const INTERVAL_SECONDS = 5 * 60;
const CHECK_EVERY_MS = 60 * 1000;

/**
 * Fetches `remote` quietly whenever the last fetch (or attempt) is older
 * than the interval. Never prompts for credentials; failures are ignored.
 */
export function useBackgroundFetch(repo: string, remote: string | null) {
  const client = useQueryClient();
  // A failed fetch doesn't update FETCH_HEAD, so remember attempts too.
  const lastAttempt = useRef(0);

  useEffect(() => {
    if (!remote) return;
    const tick = () => {
      const fetchedAt = client.getQueryData<RemoteInfo>(syncKeys.info(repo))?.lastFetchedAt ?? 0;
      const now = Date.now() / 1000;
      if (now - Math.max(fetchedAt, lastAttempt.current) < INTERVAL_SECONDS) return;
      lastAttempt.current = now;
      void runSync(client, repo, { action: "fetch", remote, background: true }).catch(() => {});
    };
    tick();
    const timer = setInterval(tick, CHECK_EVERY_MS);
    return () => clearInterval(timer);
  }, [client, repo, remote]);
}

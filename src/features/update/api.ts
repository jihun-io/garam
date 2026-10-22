import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getVersion } from "@tauri-apps/api/app";
import { Channel } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect } from "react";

import { commands, unwrap, type UpdateProgress, type UpdateStatus } from "../../ipc";

export const updateKeys = {
  status: ["update", "status"] as const,
  version: ["update", "version"] as const,
};

const NO_UPDATE: UpdateStatus = { available: null, installing: false, installed: false };

/** The app-wide update state; every window follows the same one. */
export function useUpdateStatus(): UpdateStatus {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: updateKeys.status,
    queryFn: () => commands.updateStatus(),
    staleTime: Infinity,
  });

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;
    listen<UpdateStatus>("update-changed", ({ payload }) => {
      client.setQueryData(updateKeys.status, payload);
    })
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      })
      .catch(() => {
        // Not running inside Tauri: there is only one window.
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [client]);

  return query.data ?? NO_UPDATE;
}

/** This app's version, e.g. "0.1.0". */
export function useAppVersion(): string | null {
  const query = useQuery({
    queryKey: updateKeys.version,
    queryFn: () => getVersion(),
    staleTime: Infinity,
  });
  return query.data ?? null;
}

export function checkForUpdates() {
  return unwrap(commands.updateCheck());
}

export function installUpdate(onProgress: (progress: UpdateProgress) => void) {
  const channel = new Channel<UpdateProgress>();
  channel.onmessage = onProgress;
  return unwrap(commands.updateInstall(channel));
}

export function releaseUrl(version: string): string {
  return `https://github.com/jihun-io/garam/releases/tag/v${version}`;
}

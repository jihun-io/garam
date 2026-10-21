import { useQueryClient } from "@tanstack/react-query";
import { listen } from "@tauri-apps/api/event";
import { useEffect } from "react";

import { commands } from "../../ipc";
import { changesKeys } from "./api";

/** Watches `repo` on disk and refreshes its queries when files change. */
export function useRepoWatcher(repo: string | null) {
  const client = useQueryClient();

  useEffect(() => {
    // Failing to watch is not fatal: status still refreshes on window focus.
    void commands.repoWatch(repo).catch(() => {});
  }, [repo]);

  useEffect(() => {
    if (!repo) return;
    let unlisten: (() => void) | undefined;
    let disposed = false;
    try {
      void listen<{ path: string }>("repo-changed", ({ payload }) => {
        if (payload.path === repo) {
          void client.invalidateQueries({ queryKey: changesKeys.all(repo) });
        }
      }).then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      });
    } catch {
      // Not running inside Tauri.
    }
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [client, repo]);
}

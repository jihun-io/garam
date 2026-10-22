import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { create } from "zustand";

import { commands, unwrap, type RepositoryList } from "../../ipc";
import { useNotify } from "../notify/notifyStore";
import { useSettings } from "../settings/api";
import { REPOSITORIES, useRepositoryActions } from "./api";

export type OpenTarget = "current_window" | "new_window";

/** The repository waiting for the user to say where it opens. */
export const useOpenPrompt = create<{
  path: string | null;
  ask: (path: string) => void;
  close: () => void;
}>((set) => ({
  path: null,
  ask: (path) => set({ path }),
  close: () => set({ path: null }),
}));

/**
 * Opens a repository from this window. A repository another window shows
 * brings that window forward; otherwise it opens here or in a new window,
 * as settings say (asking by default). A window showing nothing yet just
 * shows it.
 */
export function useOpenRepository() {
  const client = useQueryClient();
  const { openRepositoryIn } = useSettings();
  const openIn = useOpenIn();
  const ask = useOpenPrompt((s) => s.ask);
  const showError = useNotify((s) => s.showError);

  return useCallback(
    async (path: string) => {
      try {
        const list = await client.fetchQuery<RepositoryList>({
          queryKey: REPOSITORIES,
          queryFn: () => commands.repoList(),
        });
        const current = list.selected;
        if (current === path) return;
        if (await commands.windowFocusRepo(path)) return;
        if (current === null || openRepositoryIn === "current_window") {
          await openIn(path, "current_window");
        } else if (openRepositoryIn === "new_window") {
          await openIn(path, "new_window");
        } else {
          ask(path);
        }
      } catch (e) {
        showError(e);
      }
    },
    [client, openRepositoryIn, openIn, ask, showError],
  );
}

/** Opens `path` in this window or a new one, without asking. */
export function useOpenIn() {
  const { select } = useRepositoryActions();
  const selectHere = select.mutateAsync;
  return useCallback(
    (path: string, target: OpenTarget) =>
      target === "current_window" ? selectHere(path) : unwrap(commands.windowOpen(path)),
    [selectHere],
  );
}

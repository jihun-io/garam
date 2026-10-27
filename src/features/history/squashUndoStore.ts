import { useQuery } from "@tanstack/react-query";
import { create } from "zustand";

import { commands, unwrap, type SquashUndo } from "../../ipc";

export const squashUndoKey = (repo: string) => ["repo", repo, "squash-undo"] as const;

export function useSquashUndo(repo: string) {
  return useQuery({
    queryKey: squashUndoKey(repo),
    queryFn: () => unwrap(commands.squashUndoGet(repo)),
    retry: false,
  });
}

export const useSquashUndoDialog = create<{
  request: { repo: string; info: SquashUndo } | null;
  open: (repo: string, info: SquashUndo) => void;
  close: () => void;
}>((set) => ({
  request: null,
  open: (repo, info) => set({ request: { repo, info } }),
  close: () => set({ request: null }),
}));

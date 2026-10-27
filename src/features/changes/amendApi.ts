import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { commands, unwrap } from "../../ipc";
import { runCommand } from "../../lib/commands";
import { useNotify } from "../notify/notifyStore";
import { changesKeys, indexScope } from "./api";
import { useAmendSessions } from "./amendStore";

export function useBeginAmend(repo: string, onStarted?: () => void) {
  const set = useAmendSessions((s) => s.set);
  const showError = useNotify((s) => s.showError);
  return useMutation({
    mutationFn: async (head: string) =>
      useAmendSessions.getState().sessions[repo] ?? (await unwrap(commands.amendBegin(repo, head))),
    onSuccess: (session) => {
      onStarted?.();
      set(repo, session);
      runCommand("view.changes");
    },
    onError: showError,
    scope: indexScope(repo),
  });
}

export function useAmendActions(repo: string, id: string) {
  const client = useQueryClient();
  const { t } = useTranslation("changes");
  const showInfo = useNotify((s) => s.showInfo);
  const clear = useAmendSessions((s) => s.clear);
  const onSuccess = () => {
    clear(repo);
  };
  const onSettled = () => client.invalidateQueries({ queryKey: changesKeys.all(repo) });
  const scope = indexScope(repo);
  return {
    save: useMutation({
      mutationFn: (message: string) => unwrap(commands.amendSave(repo, id, message)),
      onSuccess: () => {
        showInfo(t("amend.done"));
        onSuccess();
      },
      onSettled,
      scope,
    }),
    cancel: useMutation({
      mutationFn: () => unwrap(commands.amendCancel(repo, id)),
      onSuccess,
      onSettled,
      scope,
    }),
  };
}

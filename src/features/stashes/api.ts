import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { TFunction } from "i18next";

import { commands, unwrap, type Stash } from "../../ipc";
import { changesKeys, indexScope } from "../changes/api";

export const stashKeys = {
  // Under the repo prefix: stashing and popping change the list, and so
  // do git commands in a terminal, which the file watcher reports.
  list: (repo: string) => ["repo", repo, "stashes"] as const,
  // A stash's contents never change.
  files: (repo: string, oid: string) => ["stash", repo, oid, "files"] as const,
};

export function useStashes(repo: string) {
  return useQuery({
    queryKey: stashKeys.list(repo),
    queryFn: () => unwrap(commands.stashList(repo)),
  });
}

export function useStashFiles(repo: string, oid: string) {
  return useQuery({
    queryKey: stashKeys.files(repo, oid),
    queryFn: () => unwrap(commands.stashFiles(repo, oid)),
    staleTime: Infinity,
  });
}

/** Stashing and restoring write the index, so they queue with other index writes. */
export function useStashActions(repo: string) {
  const client = useQueryClient();
  const onSettled = () => client.invalidateQueries({ queryKey: changesKeys.all(repo) });
  const scope = indexScope(repo);

  return {
    push: useMutation({
      mutationFn: ({
        message,
        includeUntracked,
        paths,
      }: {
        message: string;
        includeUntracked: boolean;
        paths: string[];
      }) => unwrap(commands.stashPush(repo, message || null, includeUntracked, paths)),
      onSettled,
      scope,
    }),
    apply: useMutation({
      mutationFn: ({ oid, pop }: { oid: string; pop: boolean }) =>
        unwrap(commands.stashApply(repo, oid, pop)),
      onSettled,
      scope,
    }),
    drop: useMutation({
      mutationFn: (oid: string) => unwrap(commands.stashDrop(repo, oid)),
      onSettled,
      scope,
    }),
    restore: useMutation({
      mutationFn: (oid: string) => unwrap(commands.stashRestore(repo, oid)),
      onSettled,
      scope,
    }),
    branch: useMutation({
      mutationFn: ({ oid, name }: { oid: string; name: string }) =>
        unwrap(commands.stashBranch(repo, oid, name)),
      onSettled,
      scope,
    }),
  };
}

/** A stash's title in the user's language. */
export function stashTitle(t: TFunction<"stashes">, stash: Stash): string {
  if (stash.auto && stash.branch) return t("title.auto", { branch: stash.branch });
  if (stash.message) return stash.message;
  return stash.branch ? t("title.untitled", { branch: stash.branch }) : t("title.detached");
}

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { commands, unwrap, type Branch, type SwitchMode } from "../../ipc";
import { changesKeys, indexScope } from "../changes/api";

/** A branch's full ref name, as git commands that take refs want it. */
export function refName(branch: Pick<Branch, "kind" | "name">): string {
  return `refs/${branch.kind === "local" ? "heads" : "remotes"}/${branch.name}`;
}

export const branchKeys = {
  list: (repo: string) => ["repo", repo, "branches"] as const,
  autoStash: (repo: string, branch: string) => ["repo", repo, "auto-stash", branch] as const,
  mergePreview: (repo: string, branch: string) => ["repo", repo, "merge-preview", branch] as const,
};

export function useBranches(repo: string) {
  return useQuery({
    queryKey: branchKeys.list(repo),
    queryFn: () => unwrap(commands.branchList(repo)),
  });
}

export function useAutoStash(repo: string, branch: string | null) {
  return useQuery({
    queryKey: branchKeys.autoStash(repo, branch ?? ""),
    queryFn: () => unwrap(commands.stashFindAuto(repo, branch!)),
    enabled: branch !== null,
  });
}

export function useMergePreview(repo: string, branch: string | null) {
  return useQuery({
    queryKey: branchKeys.mergePreview(repo, branch ?? ""),
    queryFn: () => unwrap(commands.branchMergePreview(repo, branch!)),
    enabled: branch !== null,
  });
}

/** Branch operations. They all rewrite HEAD/index, so they share the index scope. */
export function useBranchActions(repo: string) {
  const client = useQueryClient();
  const onSettled = () => client.invalidateQueries({ queryKey: changesKeys.all(repo) });
  const scope = indexScope(repo);

  return {
    create: useMutation({
      mutationFn: ({ name, start = null }: { name: string; start?: string | null }) =>
        unwrap(commands.branchCreate(repo, name, start)),
      onSettled,
      scope,
    }),
    switchTo: useMutation({
      mutationFn: (input: { target: Branch; mode: SwitchMode; current: string | null }) =>
        unwrap(commands.branchSwitch(repo, input.target, input.mode, input.current)),
      onSettled,
      scope,
    }),
    rename: useMutation({
      mutationFn: ({ from, to }: { from: string; to: string }) =>
        unwrap(commands.branchRename(repo, from, to)),
      onSettled,
      scope,
    }),
    remove: useMutation({
      mutationFn: ({ name, force }: { name: string; force: boolean }) =>
        unwrap(commands.branchDelete(repo, name, force)),
      onSettled,
      scope,
    }),
    merge: useMutation({
      mutationFn: (branch: string) => unwrap(commands.branchMerge(repo, branch)),
      onSettled,
      scope,
    }),
  };
}

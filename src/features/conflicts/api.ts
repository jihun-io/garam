import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { commands, unwrap, type Side } from "../../ipc";
import { changesKeys, indexScope } from "../changes/api";

export const conflictKeys = {
  state: (repo: string) => ["repo", repo, "conflicts"] as const,
};

/** The stopped operation, if any, and the files that still conflict. */
export function useConflicts(repo: string) {
  return useQuery({
    queryKey: conflictKeys.state(repo),
    queryFn: () => unwrap(commands.conflictState(repo)),
  });
}

/** Resolving writes the index, so these queue with other index writes. */
export function useConflictActions(repo: string) {
  const client = useQueryClient();
  const onSettled = () => client.invalidateQueries({ queryKey: changesKeys.all(repo) });
  const scope = indexScope(repo);

  return {
    resolve: useMutation({
      mutationFn: ({ path, side }: { path: string; side: Side }) =>
        unwrap(commands.conflictResolve(repo, path, side)),
      onSettled,
      scope,
    }),
    markResolved: useMutation({
      mutationFn: (path: string) => unwrap(commands.conflictMarkResolved(repo, path)),
      onSettled,
      scope,
    }),
    continueOperation: useMutation({
      mutationFn: () => unwrap(commands.conflictContinue(repo)),
      onSettled,
      scope,
    }),
    skip: useMutation({
      mutationFn: () => unwrap(commands.conflictSkip(repo)),
      onSettled,
      scope,
    }),
    abort: useMutation({
      mutationFn: () => unwrap(commands.conflictAbort(repo)),
      onSettled,
      scope,
    }),
  };
}

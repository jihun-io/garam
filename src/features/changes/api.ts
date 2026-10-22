import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { commands, unwrap, type CoAuthor, type FileChange, type LineRef } from "../../ipc";

export const changesKeys = {
  all: (repo: string) => ["repo", repo] as const,
  status: (repo: string) => ["repo", repo, "status"] as const,
  // The staged/unstaged state is part of the key: the diff marks which
  // lines are staged, so it must be recomputed whenever that changes.
  diff: (repo: string, file: FileChange | null) =>
    ["repo", repo, "diff", file?.path ?? "", file?.staged ?? null, file?.unstaged ?? null] as const,
  images: (repo: string, path: string) => ["repo", repo, "images", path] as const,
  head: (repo: string) => ["repo", repo, "head"] as const,
  identity: (repo: string) => ["repo", repo, "identity"] as const,
};

/**
 * Index writes must not overlap (git takes index.lock), so mutations that
 * touch the index or HEAD run one after another per repository.
 */
export const indexScope = (repo: string) => ({ id: `index:${repo}` });

export function useStatus(repo: string) {
  return useQuery({
    queryKey: changesKeys.status(repo),
    queryFn: () => unwrap(commands.statusGet(repo)),
    // Catches edits made while the watcher was unavailable.
    refetchOnWindowFocus: true,
  });
}

export function useDiff(repo: string, file: FileChange | null) {
  return useQuery({
    queryKey: changesKeys.diff(repo, file),
    queryFn: () => unwrap(commands.diffGet(repo, file!)),
    enabled: file !== null,
    // A diff kept under other staged/unstaged flags is from an older index:
    // showing it when the file's flags come back to them would briefly
    // flip the line selection back. Drop it as soon as nothing shows it.
    gcTime: 0,
    placeholderData: (previous, previousQuery) =>
      // Keep showing the old diff while the same file refreshes.
      previousQuery?.queryKey[3] === file?.path ? previous : undefined,
  });
}

export function useImages(repo: string, file: FileChange | null, enabled: boolean) {
  return useQuery({
    queryKey: changesKeys.images(repo, file?.path ?? ""),
    queryFn: () => unwrap(commands.diffImages(repo, file!)),
    enabled: enabled && file !== null,
  });
}

export function useHeadCommit(repo: string, enabled: boolean) {
  return useQuery({
    queryKey: changesKeys.head(repo),
    queryFn: () => unwrap(commands.commitHead(repo)),
    enabled,
  });
}

export function useIdentity(repo: string) {
  return useQuery({
    queryKey: changesKeys.identity(repo),
    queryFn: () => unwrap(commands.identityGet(repo)),
  });
}

/** Mutations that change the working tree or index; all refresh the repo. */
export function useChangeActions(repo: string) {
  const client = useQueryClient();
  const onSettled = () => client.invalidateQueries({ queryKey: changesKeys.all(repo) });
  const scope = indexScope(repo);

  return {
    stage: useMutation({
      mutationFn: (files: FileChange[]) => unwrap(commands.changesStage(repo, files)),
      onSettled,
      scope,
    }),
    unstage: useMutation({
      mutationFn: (files: FileChange[]) => unwrap(commands.changesUnstage(repo, files)),
      onSettled,
      scope,
    }),
    stageLines: useMutation({
      mutationFn: ({ file, selected }: { file: FileChange; selected: LineRef[] }) =>
        unwrap(commands.changesStageLines(repo, file, selected)),
      onSettled,
      scope,
    }),
    discard: useMutation({
      mutationFn: (files: FileChange[]) => unwrap(commands.changesDiscard(repo, files)),
      onSettled,
      scope,
    }),
    commit: useMutation({
      mutationFn: (input: {
        summary: string;
        description: string;
        coAuthors: CoAuthor[];
        amend: boolean;
      }) =>
        unwrap(
          commands.commitCreate(
            repo,
            input.summary,
            input.description,
            input.coAuthors,
            input.amend,
          ),
        ),
      onSettled,
      scope,
    }),
    setIdentity: useMutation({
      mutationFn: ({ name, email }: { name: string; email: string }) =>
        unwrap(commands.identitySet(name, email)),
      onSettled,
    }),
    setLocalIdentity: useMutation({
      mutationFn: ({ name, email }: { name: string; email: string }) =>
        unwrap(commands.identitySetLocal(repo, name, email)),
      onSettled,
    }),
    clearLocalIdentity: useMutation({
      mutationFn: () => unwrap(commands.identityClearLocal(repo)),
      onSettled,
    }),
  };
}

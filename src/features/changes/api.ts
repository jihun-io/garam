import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { commands, unwrap, type CoAuthor, type FileChange } from "../../ipc";

export const changesKeys = {
  all: (repo: string) => ["repo", repo] as const,
  status: (repo: string) => ["repo", repo, "status"] as const,
  diff: (repo: string, path: string) => ["repo", repo, "diff", path] as const,
  images: (repo: string, path: string) => ["repo", repo, "images", path] as const,
  head: (repo: string) => ["repo", repo, "head"] as const,
  identity: (repo: string) => ["repo", repo, "identity"] as const,
};

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
    queryKey: changesKeys.diff(repo, file?.path ?? ""),
    queryFn: () => unwrap(commands.diffGet(repo, file!)),
    enabled: file !== null,
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

  return {
    stage: useMutation({
      mutationFn: (files: FileChange[]) => unwrap(commands.changesStage(repo, files)),
      onSettled,
    }),
    unstage: useMutation({
      mutationFn: (files: FileChange[]) => unwrap(commands.changesUnstage(repo, files)),
      onSettled,
    }),
    discard: useMutation({
      mutationFn: (files: FileChange[]) => unwrap(commands.changesDiscard(repo, files)),
      onSettled,
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
    }),
    setIdentity: useMutation({
      mutationFn: ({ name, email }: { name: string; email: string }) =>
        unwrap(commands.identitySet(name, email)),
      onSettled,
    }),
  };
}

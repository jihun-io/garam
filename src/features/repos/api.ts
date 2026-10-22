import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { commands, unwrap, type RepositoryEntry } from "../../ipc";

export const REPOSITORIES = ["repositories"] as const;

const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });

export function sortRepositories(repos: RepositoryEntry[]): RepositoryEntry[] {
  return [...repos].sort((a, b) => collator.compare(a.name, b.name));
}

export function useRepositories() {
  return useQuery({
    queryKey: REPOSITORIES,
    queryFn: () => commands.repoList(),
    // Another window may have added or removed one.
    refetchOnWindowFocus: true,
    select: (list) => {
      const repositories = sortRepositories(list.repositories);
      const selected =
        repositories.find((r) => r.path === list.selected) ?? repositories[0] ?? null;
      return { repositories, selected };
    },
  });
}

/** Mutations that change the repository list, refreshing it afterwards. */
export function useRepositoryActions() {
  const client = useQueryClient();
  const refresh = () => client.invalidateQueries({ queryKey: REPOSITORIES });
  const options = { onSettled: refresh };

  return {
    add: useMutation({ mutationFn: (path: string) => unwrap(commands.repoAdd(path)), ...options }),
    initExisting: useMutation({
      mutationFn: (path: string) => unwrap(commands.repoInitExisting(path)),
      ...options,
    }),
    create: useMutation({
      mutationFn: ({ parent, name }: { parent: string; name: string }) =>
        unwrap(commands.repoCreate(parent, name)),
      ...options,
    }),
    remove: useMutation({
      mutationFn: (path: string) => unwrap(commands.repoRemove(path)),
      ...options,
    }),
    select: useMutation({
      mutationFn: (path: string) => unwrap(commands.repoSelect(path)),
      ...options,
    }),
    setAccount: useMutation({
      mutationFn: ({ path, account }: { path: string; account: string | null }) =>
        unwrap(commands.repoSetAccount(path, account)),
      ...options,
    }),
  };
}

/** Detected editors, with the one chosen in settings first. */
export function useEditorsPreferredFirst(preferred: string | null) {
  const editors = useEditors().data ?? [];
  return [...editors].sort((a, b) => Number(b.id === preferred) - Number(a.id === preferred));
}

export function useEditors() {
  return useQuery({
    queryKey: ["external", "editors"],
    queryFn: () => unwrap(commands.externalEditors()),
    staleTime: 5 * 60_000,
  });
}

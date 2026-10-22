import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import { commands, unwrap, type CommitFile, type HistoryFilter } from "../../ipc";
import { changesKeys, indexScope } from "../changes/api";

export const PAGE_SIZE = 100;

// Kept outside the ["repo", repo] prefix on purpose: that prefix is
// invalidated on every file change, while history only changes with the
// commits it starts from, which are part of the list key. Commit details
// never change.
export const historyKeys = {
  // Refs move on fetch and push without HEAD changing, so markers do live
  // under the repo prefix and refresh with the file watcher.
  markers: (repo: string) => ["repo", repo, "history-markers"] as const,
  list: (repo: string, head: string | null, filter: HistoryFilter, refs: string) =>
    ["history", repo, "list", head, filter, refs] as const,
  detail: (repo: string, oid: string) => ["history", repo, "commit", oid] as const,
  diff: (repo: string, oid: string, path: string) =>
    ["history", repo, "commit", oid, "diff", path] as const,
};

/**
 * The history `filter` selects, loaded a page at a time. `head` is HEAD's
 * commit id (`null` before the first commit, `undefined` while still
 * unknown). `refs` identifies where branches and tags point, for scopes
 * beyond HEAD (`undefined` while still unknown). While a new search loads,
 * the previous results stay.
 */
export function useHistory(
  repo: string,
  head: string | null | undefined,
  filter: HistoryFilter,
  refs: string | undefined,
) {
  return useInfiniteQuery({
    queryKey: historyKeys.list(repo, head ?? null, filter, refs ?? ""),
    queryFn: ({ pageParam }) => unwrap(commands.historyList(repo, filter, pageParam, PAGE_SIZE)),
    initialPageParam: 0,
    getNextPageParam: (last, pages) =>
      // A found hash can add one commit to the first page.
      last.length < PAGE_SIZE ? undefined : pages.length * PAGE_SIZE,
    enabled: head !== undefined && refs !== undefined,
    staleTime: Infinity,
    placeholderData: keepPreviousData,
  });
}

/** Refs, unpushed commits and commits waiting to be pulled. */
export function useHistoryMarkers(repo: string) {
  return useQuery({
    queryKey: historyKeys.markers(repo),
    queryFn: () => unwrap(commands.historyMarkers(repo)),
  });
}

export function useCommitDetail(repo: string, oid: string | null) {
  return useQuery({
    queryKey: historyKeys.detail(repo, oid ?? ""),
    queryFn: () => unwrap(commands.commitDetail(repo, oid!)),
    enabled: oid !== null,
    staleTime: Infinity,
  });
}

export function useCommitFileDiff(repo: string, oid: string, file: CommitFile | null) {
  return useQuery({
    queryKey: historyKeys.diff(repo, oid, file?.path ?? ""),
    queryFn: () => unwrap(commands.commitFileDiff(repo, oid, file!)),
    enabled: file !== null,
    staleTime: Infinity,
  });
}

/** Revert writes a commit, so it queues with other index writes. */
export function useRevert(repo: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (oid: string) => unwrap(commands.commitRevert(repo, oid)),
    onSettled: () => client.invalidateQueries({ queryKey: changesKeys.all(repo) }),
    scope: indexScope(repo),
  });
}

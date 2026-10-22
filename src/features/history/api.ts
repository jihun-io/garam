import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import {
  commands,
  unwrap,
  type CommitFile,
  type CompareMode,
  type HistoryFilter,
  type ResetMode,
} from "../../ipc";
import { changesKeys, indexScope } from "../changes/api";
import { useRemoteInfo } from "../sync/api";
import { githubWebUrl } from "./message";

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
  diff: (repo: string, source: string, path: string, ignoreWhitespace: boolean) =>
    ["history", repo, "diff", source, path, ignoreWhitespace] as const,
  images: (repo: string, source: string, path: string) =>
    ["history", repo, "images", source, path] as const,
  comparison: (repo: string, base: string, target: string, mode: CompareMode) =>
    ["repo", repo, "comparison", base, target, mode] as const,
  lost: (repo: string) => ["repo", repo, "lost-commits"] as const,
  prepare: (repo: string) => ["history", repo, "prepare"] as const,
  signature: (repo: string, oid: string) => ["history", repo, "commit", oid, "signature"] as const,
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
    queryFn: ({ pageParam, signal }) => {
      // A code search through a long history can take many seconds; stop
      // git when this page is no longer wanted (the search changed).
      const operationId = crypto.randomUUID();
      const cancel = () => void commands.operationCancel(operationId);
      signal.addEventListener("abort", cancel);
      return unwrap(commands.historyList(operationId, repo, filter, pageParam, PAGE_SIZE)).finally(
        () => signal.removeEventListener("abort", cancel),
      );
    },
    initialPageParam: 0,
    getNextPageParam: (last, pages) =>
      // A found hash can add one commit to the first page.
      last.length < PAGE_SIZE ? undefined : pages.length * PAGE_SIZE,
    enabled: head !== undefined && refs !== undefined,
    staleTime: Infinity,
    placeholderData: keepPreviousData,
  });
}

/**
 * Writes git's commit-graph file once if the repository has none. Without
 * it every history page of a large repository walks all of its commits.
 */
export function useHistoryPrepare(repo: string | null) {
  useQuery({
    queryKey: historyKeys.prepare(repo ?? ""),
    queryFn: () => unwrap(commands.historyPrepare(repo!)),
    enabled: repo !== null,
    staleTime: Infinity,
    retry: false,
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

/** Where a file's diff comes from: one commit, or the ends of a comparison. */
export type DiffSource =
  { kind: "commit"; oid: string } | { kind: "compare"; from: string; target: string };

const sourceKey = (source: DiffSource) =>
  source.kind === "commit" ? source.oid : `${source.from}..${source.target}`;

export function useFileDiff(
  repo: string,
  source: DiffSource,
  file: CommitFile | null,
  ignoreWhitespace: boolean,
) {
  return useQuery({
    queryKey: historyKeys.diff(repo, sourceKey(source), file?.path ?? "", ignoreWhitespace),
    queryFn: () =>
      unwrap(
        source.kind === "commit"
          ? commands.commitFileDiff(repo, source.oid, file!, ignoreWhitespace)
          : commands.compareFileDiff(repo, source.from, source.target, file!, ignoreWhitespace),
      ),
    enabled: file !== null,
    staleTime: Infinity,
  });
}

export function useFileImages(
  repo: string,
  source: DiffSource,
  file: CommitFile,
  enabled: boolean,
) {
  return useQuery({
    queryKey: historyKeys.images(repo, sourceKey(source), file.path),
    queryFn: () =>
      unwrap(
        source.kind === "commit"
          ? commands.commitImages(repo, source.oid, file)
          : commands.compareImages(repo, source.from, source.target, file),
      ),
    enabled,
    staleTime: Infinity,
  });
}

/** Under the repo prefix: branches move, and the comparison with them. */
export function useComparison(repo: string, base: string, target: string, mode: CompareMode) {
  return useQuery({
    queryKey: historyKeys.comparison(repo, base, target, mode),
    queryFn: () => unwrap(commands.compareGet(repo, base, target, mode)),
    placeholderData: keepPreviousData,
  });
}

export function useLostCommits(repo: string) {
  return useQuery({
    queryKey: historyKeys.lost(repo),
    queryFn: () => unwrap(commands.lostCommits(repo)),
  });
}

/** Checked on its own, since it may run gpg. */
export function useCommitSignature(repo: string, oid: string, enabled: boolean) {
  return useQuery({
    queryKey: historyKeys.signature(repo, oid),
    queryFn: () => unwrap(commands.commitSignature(repo, oid)),
    enabled,
    staleTime: Infinity,
  });
}

/** The default remote's page on github.com, for links; `null` elsewhere. */
export function useRemoteWebUrl(repo: string): string | null {
  const info = useRemoteInfo(repo).data;
  const remote = info?.remotes.find((r) => r.name === info.defaultRemote);
  return remote ? githubWebUrl(remote.url) : null;
}

/** Revert writes commits (newest first), so it queues with other index writes. */
export function useRevert(repo: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (oids: string[]) => unwrap(commands.commitRevert(repo, oids)),
    onSettled: () => client.invalidateQueries({ queryKey: changesKeys.all(repo) }),
    scope: indexScope(repo),
  });
}

/**
 * Commit actions from the history. Those that move HEAD or write commits
 * queue with other index writes; tagging only adds a ref.
 */
export function useCommitActions(repo: string) {
  const client = useQueryClient();
  const onSettled = () => client.invalidateQueries({ queryKey: changesKeys.all(repo) });
  const scope = indexScope(repo);
  return {
    /** Oldest first. */
    cherryPick: useMutation({
      mutationFn: (oids: string[]) => unwrap(commands.commitCherryPick(repo, oids)),
      onSettled,
      scope,
    }),
    /** Switches to `branch` first; oldest first. */
    cherryPickOnto: useMutation({
      mutationFn: ({ branch, oids }: { branch: string; oids: string[] }) =>
        unwrap(commands.commitCherryPickOnto(repo, branch, oids)),
      onSettled,
      scope,
    }),
    /** The newest commits of HEAD, newest first, in their new order. */
    reorder: useMutation({
      mutationFn: (order: string[]) => unwrap(commands.commitReorder(repo, order)),
      onSettled,
      scope,
    }),
    squash: useMutation({
      mutationFn: ({ oids, message }: { oids: string[]; message: string }) =>
        unwrap(commands.commitSquash(repo, oids, message)),
      onSettled,
      scope,
    }),
    reset: useMutation({
      mutationFn: ({ oid, mode }: { oid: string; mode: ResetMode }) =>
        unwrap(commands.commitReset(repo, oid, mode)),
      onSettled,
      scope,
    }),
    undo: useMutation({
      mutationFn: (oid: string) => unwrap(commands.commitUndo(repo, oid)),
      onSettled,
      scope,
    }),
    checkout: useMutation({
      mutationFn: (oid: string) => unwrap(commands.commitCheckout(repo, oid)),
      onSettled,
      scope,
    }),
    createTag: useMutation({
      mutationFn: ({ name, oid, message }: { name: string; oid: string; message: string }) =>
        unwrap(commands.tagCreate(repo, name, oid, message.trim() || null)),
      onSettled,
    }),
  };
}

import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";

import { CommandError, commands, unwrap, type PullOutcome } from "../../ipc";
import { changesKeys, indexScope } from "../changes/api";
import { pullRequestKeys } from "../pullRequests/keys";
import { tagKeys } from "../tags/keys";
import { networkChannel } from "./networkChannel";
import { useSyncStore, type SyncAction } from "./syncStore";

export const syncKeys = {
  info: (repo: string) => ["repo", repo, "remotes"] as const,
};

export function useRemoteInfo(repo: string) {
  return useQuery({
    queryKey: syncKeys.info(repo),
    queryFn: () => unwrap(commands.remoteInfo(repo)),
  });
}

export type SyncRequest = {
  action: SyncAction;
  /** Remote to fetch from or publish to. */
  remote: string | null;
  background?: boolean;
  /** Pull only: stash local changes first and put them back after. */
  autostash?: boolean;
};

/** What a finished operation did; `"done"` for everything but pull. */
export type SyncResult = PullOutcome | "done";

/**
 * Runs one network operation, tracking it in the sync store. If another one
 * is already running in `repo`, does nothing and resolves to `null`.
 */
export async function runSync(
  client: QueryClient,
  repo: string,
  { action, remote, background = false, autostash = false }: SyncRequest,
): Promise<SyncResult | null> {
  const operationId = crypto.randomUUID();
  const store = useSyncStore.getState();
  if (!store.start(repo, { action, operationId, progress: null, background })) return null;

  const channel = networkChannel((progress) =>
    useSyncStore.getState().setProgress(repo, operationId, progress),
  );
  const needRemote = () => {
    if (remote === null) {
      throw new CommandError({ kind: "no_remote", params: {}, detail: null });
    }
    return remote;
  };
  try {
    switch (action) {
      case "fetch":
        await unwrap(commands.remoteFetch(operationId, repo, needRemote(), !background, channel));
        return "done";
      case "pull":
        return await unwrap(commands.remotePull(operationId, repo, autostash, channel));
      case "push":
        await unwrap(commands.remotePush(operationId, repo, channel));
        return "done";
      case "publish":
        await unwrap(commands.remotePublish(operationId, repo, needRemote(), channel));
        return "done";
    }
  } finally {
    useSyncStore.getState().finish(repo, operationId);
    await client.invalidateQueries({ queryKey: changesKeys.all(repo) });
    // Fetching and pushing are when the remote's tags change.
    await client.invalidateQueries({ queryKey: tagKeys.states(repo) });
    await client.invalidateQueries({ queryKey: pullRequestKeys.list(repo) });
  }
}

/**
 * Deletes the tag `name` on `remote`. It shows no progress, but may ask for
 * credentials like any network operation.
 */
export async function deleteRemoteTag(repo: string, remote: string, name: string): Promise<void> {
  const channel = networkChannel(() => {});
  await unwrap(commands.remoteTagDelete(crypto.randomUUID(), repo, remote, name, channel));
}

/**
 * Sync actions for `repo`. Pull rewrites HEAD and the index, so it queues
 * behind other index writes (commit, stage); the rest only touch refs.
 */
export function useSyncActions(repo: string) {
  const client = useQueryClient();
  const pull = useMutation({
    mutationFn: (request: SyncRequest) => runSync(client, repo, request),
    scope: indexScope(repo),
  });
  const other = useMutation({
    mutationFn: (request: SyncRequest) => runSync(client, repo, request),
  });
  return {
    run: (request: SyncRequest) =>
      request.action === "pull" ? pull.mutateAsync(request) : other.mutateAsync(request),
    cancel: () => {
      const running = useSyncStore.getState().running[repo];
      if (running) void commands.operationCancel(running.operationId);
    },
  };
}

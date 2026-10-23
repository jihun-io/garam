import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";

import { commands, unwrap, type TagOrder, type TagSync } from "../../ipc";
import { changesKeys } from "../changes/api";
import { useRemoteInfo } from "../sync/api";
import { networkChannel } from "../sync/networkChannel";
import { tagKeys } from "./keys";

export function useTags(repo: string, order: TagOrder = "version") {
  return useQuery({
    queryKey: tagKeys.list(repo, order),
    queryFn: () => unwrap(commands.tagList(repo, order)),
    // Switching the order keeps the open list on screen while it reloads.
    placeholderData: keepPreviousData,
  });
}

/** How long the remote's tags count as current. */
const STATES_STALE_MS = 5 * 60 * 1000;

/**
 * How each tag compares with the default remote's, asked without a sign-in
 * prompt. `states` is null while unknown: no remote, still asking, or the
 * remote wanted credentials (`failed`; `recheck` may ask for them).
 */
export function useTagStates(repo: string) {
  const client = useQueryClient();
  const remote = useRemoteInfo(repo).data?.defaultRemote ?? null;
  const names = useTags(repo).data?.map((t) => t.name);
  // A tag made or deleted changes the key, so it is checked again.
  const key = [...tagKeys.states(repo), remote, names?.join("\n") ?? ""];
  const ask = (interactive: boolean) =>
    unwrap(
      commands.remoteTagStates(
        crypto.randomUUID(),
        repo,
        remote!,
        interactive,
        networkChannel(() => {}),
      ),
    );
  const query = useQuery({
    queryKey: key,
    queryFn: () => ask(false),
    enabled: remote !== null && names !== undefined && names.length > 0,
    staleTime: STATES_STALE_MS,
    retry: false,
  });
  const recheck = useMutation({
    mutationFn: () => ask(true),
    onSuccess: (states) => client.setQueryData(key, states),
  });
  const states = useMemo(
    () => (query.data ? new Map(query.data.map((s) => [s.name, s.sync])) : null),
    [query.data],
  );
  return {
    remote,
    states,
    failed: query.isError && !recheck.isSuccess,
    recheck: () => recheck.mutate(),
    rechecking: recheck.isPending,
  };
}

export type TagStates = ReturnType<typeof useTagStates>;

/** Whether pushing would send `name` somewhere it isn't yet, or replace it. */
export function tagSync(states: Map<string, TagSync> | null, name: string): TagSync | null {
  return states?.get(name) ?? null;
}

/** Pushes tags to the default remote; `force` replaces the remote's. */
export function useTagPush(repo: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ remote, names, force }: { remote: string; names: string[]; force: boolean }) =>
      unwrap(
        commands.remoteTagPush(
          crypto.randomUUID(),
          repo,
          remote,
          names,
          force,
          networkChannel(() => {}),
        ),
      ),
    onSettled: async () => {
      await client.invalidateQueries({ queryKey: tagKeys.states(repo) });
      await client.invalidateQueries({ queryKey: changesKeys.all(repo) });
    },
  });
}

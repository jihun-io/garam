import { Channel } from "@tauri-apps/api/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { commands, unwrap, type Account, type SignInCode } from "../../ipc";
import { useRepositories } from "../repos/api";
import { useRemoteInfo } from "../sync/api";
import { parseRemote, suggestAccount, type GitHubRemote } from "./repoAccount";

export const accountKeys = {
  all: ["accounts"] as const,
};

export function useAccounts() {
  return useQuery({
    queryKey: accountKeys.all,
    queryFn: () => commands.githubAccounts(),
  });
}

export type RepoAccount = {
  accounts: Account[];
  /** The account chosen for the repository, if it's still signed in. */
  account: Account | null;
  /** The chosen key, also when that account was signed out since. */
  chosenKey: string | null;
  /** The default remote, when it's on a known host. */
  remote: GitHubRemote | null;
  suggestion: Account | null;
};

/** The GitHub account chosen for `repo`, and the one that would fit. */
export function useRepoAccount(repo: string, authorEmail: string | null): RepoAccount {
  const accounts = useAccounts().data?.accounts ?? [];
  const entry = useRepositories().data?.repositories.find((r) => r.path === repo);
  const info = useRemoteInfo(repo).data;
  const url =
    info?.remotes.find((r) => r.name === info.defaultRemote)?.url ?? info?.remotes[0]?.url;
  const remote = url ? parseRemote(url) : null;
  const chosenKey = entry?.account ?? null;
  return {
    accounts,
    account: accounts.find((a) => a.key === chosenKey) ?? null,
    chosenKey,
    remote,
    suggestion: suggestAccount(accounts, remote, authorEmail),
  };
}

/**
 * Signs in with the device flow. `onCode` gets the code to enter on
 * GitHub; the promise settles once the user approves, declines, or the
 * sign-in is cancelled with `operationCancel(operationId)`.
 */
export function useSignIn() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      operationId,
      onCode,
    }: {
      operationId: string;
      onCode: (code: SignInCode) => void;
    }) => {
      const channel = new Channel<SignInCode>();
      channel.onmessage = onCode;
      return unwrap(commands.githubSignIn(operationId, channel));
    },
    onSettled: () => client.invalidateQueries({ queryKey: accountKeys.all }),
  });
}

export function useSignOut() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (key: string) => unwrap(commands.githubSignOut(key)),
    onSettled: () => client.invalidateQueries({ queryKey: accountKeys.all }),
  });
}

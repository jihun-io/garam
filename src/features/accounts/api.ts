import { Channel } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { commands, unwrap, type Account, type SavedLogin, type SignInCode } from "../../ipc";
import { useRepositories } from "../repos/api";
import { useRemoteInfo } from "../sync/api";
import { parseRemote, suggestAccount, type GitHubRemote } from "./repoAccount";

export const accountKeys = {
  all: ["accounts"] as const,
  logins: ["logins"] as const,
};

/** Logins remembered on this computer for remotes without a credential helper. */
export function useSavedLogins() {
  return useQuery({
    queryKey: accountKeys.logins,
    queryFn: () => commands.loginsList(),
  });
}

export function useForgetLogin() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (login: SavedLogin) =>
      unwrap(commands.loginForget(login.protocol, login.host, login.username)),
    onSettled: () => client.invalidateQueries({ queryKey: accountKeys.logins }),
  });
}

export function useAccounts() {
  return useQuery({
    queryKey: accountKeys.all,
    queryFn: () => commands.githubAccounts(),
  });
}

/**
 * Refreshes the account list when another window signs in or out. Each
 * window has its own query cache, so the settings window's sign-in alone
 * doesn't reach the repository windows.
 */
export function AccountsSync() {
  const client = useQueryClient();
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;
    listen("accounts-changed", () => {
      void client.invalidateQueries({ queryKey: accountKeys.all });
    })
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      })
      .catch(() => {
        // Not running inside Tauri: there is only one window.
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [client]);
  return null;
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

export const sshKeys = {
  all: ["ssh", "keys"] as const,
  repo: (repo: string) => ["repo", repo, "sshKey"] as const,
};

/** Private keys in `~/.ssh`. Only read when `enabled` (an SSH remote). */
export function useSshKeys(enabled: boolean) {
  return useQuery({
    queryKey: sshKeys.all,
    queryFn: () => unwrap(commands.sshKeys()),
    enabled,
  });
}

/** The SSH command the repository sets in its own config. */
export function useRepoSshKey(repo: string, enabled: boolean) {
  return useQuery({
    queryKey: sshKeys.repo(repo),
    queryFn: () => unwrap(commands.sshRepoKey(repo)),
    enabled,
  });
}

export function useSetRepoSshKey(repo: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (key: string | null) => unwrap(commands.sshSetRepoKey(repo, key)),
    onSettled: () => client.invalidateQueries({ queryKey: sshKeys.repo(repo) }),
  });
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

/** Signs in to a GitHub Enterprise Server with a personal access token. */
export function useSignInWithToken() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ host, token }: { host: string; token: string }) =>
      unwrap(commands.githubSignInWithToken(host, token)),
    onSuccess: () => client.invalidateQueries({ queryKey: accountKeys.all }),
  });
}

export function useSignOut() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (key: string) => unwrap(commands.githubSignOut(key)),
    onSettled: () => client.invalidateQueries({ queryKey: accountKeys.all }),
  });
}

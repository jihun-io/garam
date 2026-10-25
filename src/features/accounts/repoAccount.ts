import type { Account } from "../../ipc";

export type GitHubRemote = {
  host: string;
  owner: string;
  /** The user name written into an HTTPS URL (`https://me@github.com/...`). */
  urlUser: string | null;
  /** Only HTTPS remotes use the account's token; SSH remotes use SSH keys. */
  https: boolean;
};

/**
 * Reads the host and owner from a remote URL: `https://[user@]host/owner/repo`,
 * `ssh://git@host/owner/repo` or `git@host:owner/repo`.
 */
export function parseRemote(url: string): GitHubRemote | null {
  const https = /^https?:\/\/(?:([^@/]+)@)?([^/:]+)(?::\d+)?\/([^/]+)\//i.exec(url);
  if (https) {
    return {
      host: https[2].toLowerCase(),
      owner: https[3],
      urlUser: https[1] ? decodeURIComponent(https[1].split(":")[0]) : null,
      https: true,
    };
  }
  const ssh =
    /^ssh:\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/([^/]+)\//i.exec(url) ??
    /^(?:[^@/]+@)?([^/:]+):([^/]+)\//.exec(url);
  if (ssh) return { host: ssh[1].toLowerCase(), owner: ssh[2], urlUser: null, https: false };
  return null;
}

/** "@login (Name)", or "@login" when the account has no name. */
export function accountLabel(account: Account): string {
  return account.name ? `@${account.login} (${account.name})` : `@${account.login}`;
}

/** Addresses GitHub links to the account: verified emails and noreply. */
export function accountEmails(account: Account): string[] {
  return [...account.emails, account.noreplyEmail];
}

/** Whether GitHub will show commits by `email` as the account's. */
export function emailBelongsTo(account: Account, email: string): boolean {
  const lower = email.toLowerCase();
  return accountEmails(account).some((e) => e.toLowerCase() === lower);
}

/**
 * The account that most likely fits a repository: the user name in the
 * remote URL, then the remote's owner, then a member of the owning
 * organization, then the commit author's email.
 */
export function suggestAccount(
  accounts: Account[],
  remote: GitHubRemote | null,
  authorEmail: string | null,
): Account | null {
  const onHost = remote ? accounts.filter((a) => a.host === remote.host) : accounts;
  const byLogin = (login: string | null) =>
    login ? onHost.find((a) => a.login.toLowerCase() === login.toLowerCase()) : undefined;
  const byEmail = (candidates: Account[]) =>
    authorEmail ? candidates.find((a) => emailBelongsTo(a, authorEmail)) : undefined;
  const owner = remote?.owner.toLowerCase();
  const members = owner
    ? onHost.filter((a) => (a.orgs ?? []).some((o) => o.toLowerCase() === owner))
    : [];
  return (
    byLogin(remote?.urlUser ?? null) ??
    byLogin(remote?.owner ?? null) ??
    // When several accounts are members, the author email picks one.
    byEmail(members) ??
    members[0] ??
    byEmail(onHost) ??
    null
  );
}

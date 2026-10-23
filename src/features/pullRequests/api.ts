import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  commands,
  unwrap,
  type BranchPullRequest,
  type BranchStatus,
  type NewPullRequest,
  type PullRequest,
  type PullRequestContext,
} from "../../ipc";
import { useComparison } from "../history/api";
import { useRepositories } from "../repos/api";
import { useRemoteInfo } from "../sync/api";
import { sameRepo } from "./fill";
import { pullRequestKeys } from "./keys";

/** How long what GitHub said counts as current. */
const STALE_MS = 60 * 1000;
/** How often badges refresh while the window is in front. */
const REFRESH_MS = 5 * 60 * 1000;
/** ...and while the current branch's checks are still running. */
const REFRESH_PENDING_MS = 60 * 1000;

/**
 * What changes the answer: the default remote and the account chosen for
 * the repository. Both are part of the query keys.
 */
function useAccessKey(repo: string): string {
  const info = useRemoteInfo(repo).data;
  const account = useRepositories().data?.repositories.find((r) => r.path === repo)?.account;
  const url = info?.remotes.find((r) => r.name === info.defaultRemote)?.url ?? "";
  return `${url}\n${account ?? ""}`;
}

export function usePullRequestContext(repo: string) {
  const access = useAccessKey(repo);
  return useQuery({
    queryKey: [...pullRequestKeys.context(repo), access],
    queryFn: () => unwrap(commands.pullRequestContext(repo)),
    // A refusal may be lifted on GitHub at any moment (an organization
    // approving Garam), so it's asked again whenever something looks.
    staleTime: (query) => (query.state.data?.status === "blocked" ? 0 : 5 * STALE_MS),
    retry: false,
  });
}

/** The targets, once the repository can use pull requests. */
export function readyContext(context: PullRequestContext | null | undefined) {
  return context?.status === "ready" ? context : null;
}

/**
 * The remote is on github.com. Without an account, pull request commands
 * still show and ask for one; when GitHub refuses, they show and explain.
 */
export function supportsPullRequests(context: PullRequestContext | null | undefined): boolean {
  return context !== null && context !== undefined && context.status !== "unsupported";
}

/**
 * Pull requests of the local branches. Failing quietly is fine: badges
 * then don't show, and nothing else depends on them.
 */
export function usePullRequests(repo: string, current: string | null) {
  const access = useAccessKey(repo);
  const ready = readyContext(usePullRequestContext(repo).data) !== null;
  return useQuery({
    queryKey: [...pullRequestKeys.list(repo), access],
    queryFn: () => unwrap(commands.pullRequestList(repo)),
    enabled: ready,
    staleTime: STALE_MS,
    retry: false,
    refetchInterval: (query) => {
      const mine = query.state.data?.find((p) => p.branch === current)?.pullRequest;
      return mine?.state === "open" && mine.checks?.state === "pending"
        ? REFRESH_PENDING_MS
        : REFRESH_MS;
    },
  });
}

/**
 * The pull request to show for `branch`. A merged or closed one counts only
 * while the branch still ends where it did; after new commits a new pull
 * request can be made.
 */
export function branchPullRequest(
  list: BranchPullRequest[] | undefined,
  branch: string | null,
  oid: string | null,
): PullRequest | null {
  if (!list || branch === null) return null;
  const pr = list.find((p) => p.branch === branch)?.pullRequest ?? null;
  if (!pr) return null;
  return pr.state === "open" || pr.headOid === oid ? pr : null;
}

export function usePullRequestTemplate(repo: string, base: string | null) {
  return useQuery({
    queryKey: pullRequestKeys.template(repo, base ?? ""),
    queryFn: () => unwrap(commands.pullRequestTemplate(repo, base!)),
    enabled: base !== null,
  });
}

export function useCreatePullRequest(repo: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      owner,
      name,
      pullRequest,
    }: {
      owner: string;
      name: string;
      pullRequest: NewPullRequest;
    }) => unwrap(commands.pullRequestCreate(repo, owner, name, pullRequest)),
    onSettled: () => client.invalidateQueries({ queryKey: pullRequestKeys.list(repo) }),
  });
}

/**
 * Whether to suggest a pull request for the current branch, outside the
 * menus: the branch isn't the repository's default branch, has no pull
 * request yet, and holds commits the base lacks. On `main` itself nothing
 * is suggested. Without an account, or when GitHub refused, the default
 * branch comes from git (`origin/HEAD`), and the suggestion leads to
 * choosing an account or to what GitHub said.
 */
export function usePullRequestOffer(repo: string, status: BranchStatus | undefined): boolean {
  const context = usePullRequestContext(repo).data;
  const ready = readyContext(context);
  const head = status?.head ?? null;
  const list = usePullRequests(repo, head);
  const existing = branchPullRequest(list.data, head, status?.oid ?? null);

  // The base the dialog starts with: the first target's default branch
  // (the parent's, for a fork), and the repository's own default branch.
  let base: string | null = null;
  let ownDefault: string | null = null;
  let known = false;
  if (ready) {
    const first = ready.targets[0];
    base =
      first?.remote && first.repo.defaultBranch
        ? `refs/remotes/${first.remote}/${first.repo.defaultBranch}`
        : null;
    ownDefault =
      ready.targets.find((t) => sameRepo(t.repo, ready.head))?.repo.defaultBranch ?? null;
    known = list.isSuccess && existing === null;
  } else if (
    (context?.status === "no_account" || context?.status === "blocked") &&
    context.defaultBranch
  ) {
    base = `refs/remotes/${context.remote}/${context.defaultBranch}`;
    ownDefault = context.defaultBranch;
    known = true;
  }
  const eligible = known && head !== null && !!status?.oid && head !== ownDefault;
  const comparison = useComparison(
    repo,
    base ?? "",
    `refs/heads/${head ?? ""}`,
    "three_dot",
    eligible && base !== null,
  );
  if (!eligible) return false;
  // Without a local remote for the base there's nothing to compare; offer.
  return base === null || (comparison.data?.ahead ?? 0) > 0;
}

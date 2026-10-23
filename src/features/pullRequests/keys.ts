/**
 * Pull request queries. They ask GitHub over the network, so they stay out
 * of the `["repo", repo]` prefix the file watcher invalidates; fetching,
 * pushing and creating a pull request refresh them instead.
 */
export const pullRequestKeys = {
  all: (repo: string) => ["pull-requests", repo] as const,
  context: (repo: string) => ["pull-requests", repo, "context"] as const,
  list: (repo: string) => ["pull-requests", repo, "list"] as const,
  template: (repo: string, base: string) => ["repo", repo, "pr-template", base] as const,
};

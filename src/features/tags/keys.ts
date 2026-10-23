/**
 * Tag queries. The remote's tags are asked over the network, so they stay
 * out of the `["repo", repo]` prefix the file watcher invalidates; fetching
 * and pushing refresh them instead.
 */
export const tagKeys = {
  list: (repo: string, order: string) => ["repo", repo, "tags", order] as const,
  states: (repo: string) => ["tag-states", repo] as const,
};

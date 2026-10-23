/**
 * The title and body a new pull request starts with, the way the web fills
 * them: one commit gives its own message, several give the branch name and
 * a list of their summaries. A template on the base branch wins for the body.
 */
export function suggestText({
  branch,
  summaries,
  singleBody,
  template,
}: {
  branch: string;
  /** Summaries of the commits the branch adds, newest first. */
  summaries: string[];
  /** The body of the only commit, when there is exactly one. */
  singleBody: string | null;
  template: string | null;
}): { title: string; body: string } {
  const single = summaries.length === 1;
  const title = single ? summaries[0] : readableBranch(branch);
  const commitsBody = single
    ? (singleBody ?? "")
    : [...summaries]
        .reverse()
        .map((s) => `- ${s}`)
        .join("\n");
  return { title, body: template ?? commitsBody };
}

/** `feat/tag-list` → `Feat/tag list`. */
export function readableBranch(branch: string): string {
  const words = branch.replace(/[-_]+/g, " ").trim();
  return words.charAt(0).toLocaleUpperCase() + words.slice(1);
}

/**
 * The `head` GitHub expects: the branch name when the pull request stays
 * in the same repository, `owner:branch` when it comes from a fork.
 */
export function headRef(head: RepoName, target: RepoName, branch: string): string {
  return sameRepo(head, target) ? branch : `${head.owner}:${branch}`;
}

type RepoName = { owner: string; name: string };

/** GitHub ignores letter case in owner and repository names. */
export function sameRepo(a: RepoName, b: RepoName): boolean {
  return (
    a.owner.toLowerCase() === b.owner.toLowerCase() && a.name.toLowerCase() === b.name.toLowerCase()
  );
}

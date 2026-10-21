/**
 * Turns typed text into a valid branch name, the way people expect:
 * spaces become dashes and characters git rejects are dropped.
 * Final validation still happens in git (`check-ref-format`).
 */
export function sanitizeBranchName(input: string): string {
  return (
    input
      .trim()
      .replace(/\s+/g, "-")
      // eslint-disable-next-line no-control-regex
      .replace(/[~^:?*[\\\x00-\x1f\x7f]/g, "")
      .replace(/\.{2,}/g, ".")
      .replace(/\/{2,}/g, "/")
      .replace(/@\{/g, "@")
      .replace(/^[-/.]+/, "")
      .replace(/(\.lock|[/.])+$/i, "")
  );
}

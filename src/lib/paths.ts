/** Joins a directory and a single name using the directory's separator. */
export function joinPath(dir: string, name: string): string {
  const sep = dir.includes("\\") && !dir.includes("/") ? "\\" : "/";
  return dir.endsWith(sep) ? `${dir}${name}` : `${dir}${sep}${name}`;
}

/**
 * Guesses a folder name from a clone URL:
 * `https://host/owner/repo.git` and `git@host:owner/repo.git` both give `repo`.
 */
export function repoNameFromUrl(url: string): string {
  const trimmed = url.trim().replace(/[/\\]+$/, "");
  const last = trimmed.split(/[/\\:]/).pop() ?? "";
  return last.replace(/\.git$/i, "");
}

/** Shortens the user's home folder to `~` for display. */
export function displayPath(path: string): string {
  return path.replace(/^(\/Users\/[^/]+|\/home\/[^/]+|[A-Za-z]:\\Users\\[^\\]+)(?=$|[/\\])/, "~");
}

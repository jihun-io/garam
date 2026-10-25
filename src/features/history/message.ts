// Reading commit messages: Conventional Commits prefixes, co-author
// trailers and issue references.

/** Types from the Conventional Commits spec and its common extensions. */
const TYPES = new Set([
  "feat",
  "fix",
  "docs",
  "style",
  "refactor",
  "perf",
  "test",
  "build",
  "ci",
  "chore",
  "revert",
]);

export type Conventional = {
  type: string;
  scope: string | null;
  /** Marked with `!` before the colon. */
  breaking: boolean;
  /** The summary after the prefix. */
  subject: string;
};

const PREFIX = /^([a-z]+)(?:\(([^()\r\n]+)\))?(!)?: +(.+)$/i;

/** `fix(ui)!: Thing` → its parts; `null` when the summary has no known prefix. */
export function parseConventional(summary: string): Conventional | null {
  const match = PREFIX.exec(summary);
  if (!match || !TYPES.has(match[1].toLowerCase())) return null;
  return {
    type: match[1].toLowerCase(),
    scope: match[2]?.trim() || null,
    breaking: match[3] === "!",
    subject: match[4],
  };
}

/** A `!` prefix or a `BREAKING CHANGE:` footer. */
export function isBreaking(summary: string, body: string): boolean {
  return (parseConventional(summary)?.breaking ?? false) || /^BREAKING[ -]CHANGE: /m.test(body);
}

export type Person = { name: string; email: string };

const CO_AUTHOR = /^co-authored-by:\s*(.+?)\s*<([^<>\s]+)>\s*$/i;

/** Takes `Co-authored-by` trailers out of a message body. */
export function splitCoAuthors(body: string): { body: string; coAuthors: Person[] } {
  const coAuthors: Person[] = [];
  const kept = body.split("\n").filter((line) => {
    const match = CO_AUTHOR.exec(line.trim());
    if (match) coAuthors.push({ name: match[1], email: match[2] });
    return !match;
  });
  return { body: kept.join("\n").trim(), coAuthors };
}

export type MessagePart = { text: string } | { issue: number; text: string };

/** Splits text around `#123` references (not `a#1` or `&#39;`). */
export function linkIssues(text: string): MessagePart[] {
  const parts: MessagePart[] = [];
  const pattern = /(^|[^\w&#/])#(\d+)\b/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const start = match.index + match[1].length;
    if (start > last) parts.push({ text: text.slice(last, start) });
    parts.push({ issue: Number(match[2]), text: `#${match[2]}` });
    last = start + match[2].length + 1;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}

/**
 * The web page of a repository on github.com, or on another GitHub host
 * in `hosts` (an Enterprise Server someone signed in to), from its remote
 * URL, for links to issues and commits. Other hosts get none.
 */
export function githubWebUrl(remoteUrl: string, hosts: string[] = []): string | null {
  const match =
    /^https?:\/\/(?:[^@/]+@)?([^/:@]+)(?::\d+)?\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/i.exec(
      remoteUrl,
    ) ??
    /^ssh:\/\/(?:[^@/]+@)?([^/:@]+)(?::\d+)?\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/i.exec(remoteUrl) ??
    /^(?:[^@/]+@)?([^/:@]+):([^/]+)\/([^/]+?)(?:\.git)?\/?$/i.exec(remoteUrl);
  if (!match) return null;
  const host = match[1].toLowerCase();
  const known = host === "github.com" || hosts.some((h) => h.toLowerCase() === host);
  return known ? `https://${host}/${match[2]}/${match[3]}` : null;
}

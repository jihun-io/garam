import type { FileChange } from "../../ipc";

export type DisplayKind = "added" | "modified" | "deleted" | "renamed" | "conflicted";

/** One label for a file, combining its staged and unstaged changes. */
export function displayKind(file: FileChange): DisplayKind {
  const { staged, unstaged } = file;
  if (staged === "conflicted") return "conflicted";
  if (staged === "renamed" || staged === "copied") return "renamed";
  if (staged === "added" || unstaged === "untracked") return "added";
  if (staged === "deleted" || unstaged === "deleted") return "deleted";
  return "modified";
}

export type CheckState = "checked" | "unchecked" | "mixed";

/** Whether the file is included in the next commit (staged). */
export function checkState(file: FileChange): CheckState {
  if (!file.staged || file.staged === "conflicted") return "unchecked";
  return file.unstaged ? "mixed" : "checked";
}

export function combinedCheckState(files: FileChange[]): CheckState {
  if (files.length === 0) return "unchecked";
  const states = new Set(files.map(checkState));
  if (states.size === 1 && states.has("checked")) return "checked";
  if (states.size === 1 && states.has("unchecked")) return "unchecked";
  return "mixed";
}

/** Splits `dir/sub/name.ext` into the folder part and the file name. */
export function splitPath(path: string): { dir: string; name: string } {
  const i = path.lastIndexOf("/");
  return i < 0 ? { dir: "", name: path } : { dir: path.slice(0, i + 1), name: path.slice(i + 1) };
}

const IMAGE_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "bmp",
  "ico",
  "svg",
  "avif",
]);

export function isImage(path: string): boolean {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return IMAGE_EXTENSIONS.has(ext);
}

export type CoAuthorParse =
  { ok: true; coAuthors: { name: string; email: string }[] } | { ok: false };

/** Parses "Name <email>" lines. Blank lines are ignored. */
export function parseCoAuthors(text: string): CoAuthorParse {
  const coAuthors = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const match = /^(.+?)\s*<([^<>\s]+@[^<>\s]+)>$/.exec(trimmed);
    if (!match) return { ok: false };
    coAuthors.push({ name: match[1].trim(), email: match[2] });
  }
  return { ok: true, coAuthors };
}

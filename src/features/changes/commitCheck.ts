import type { Finding, SecretKind } from "../../ipc";

export type SecretHit = { secret: SecretKind; line: number | null; preview: string | null };

/** One row of the check dialog: a file or a group of files, and its fixes. */
export type CheckRow =
  | {
      kind: "secret";
      path: string;
      hits: SecretHit[];
      /** The `.gitignore` line that would leave the file out, for `.env` files. */
      ignorePattern: string | null;
    }
  | { kind: "large_file"; path: string; mib: number }
  | { kind: "ignorable"; pattern: string; paths: string[] };

/** GitHub refuses to push files larger than this. */
export const GITHUB_LIMIT_MIB = 100;

export const LFS_URL = "https://git-lfs.com";

/**
 * Rows in the order the engine reports them (secrets, large files, ignorable
 * files), with a file's secrets on one row so it has one set of buttons.
 */
export function checkRows(findings: Finding[]): CheckRow[] {
  const rows: CheckRow[] = [];
  for (const finding of findings) {
    if (finding.kind === "secret") {
      const hit = { secret: finding.secret, line: finding.line, preview: finding.preview };
      const row = rows.find((r) => r.kind === "secret" && r.path === finding.path);
      if (row?.kind === "secret") {
        row.hits.push(hit);
      } else {
        rows.push({
          kind: "secret",
          path: finding.path,
          hits: [hit],
          ignorePattern: finding.secret === "env_file" ? fileName(finding.path) : null,
        });
      }
    } else {
      rows.push(finding);
    }
  }
  return rows;
}

/** The files a row's fix takes out of the commit. */
export function rowPaths(row: CheckRow): string[] {
  return row.kind === "ignorable" ? row.paths : [row.path];
}

export function rowKey(row: CheckRow): string {
  return row.kind === "ignorable" ? `ignorable:${row.pattern}` : `${row.kind}:${row.path}`;
}

const fileName = (path: string) => path.slice(path.lastIndexOf("/") + 1);

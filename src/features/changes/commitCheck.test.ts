import { describe, expect, it } from "vitest";

import { checkRows } from "./commitCheck";

describe("checkRows", () => {
  it("puts a file's secrets on one row and offers .gitignore for .env files", () => {
    expect(
      checkRows([
        { kind: "secret", path: "app/.env", secret: "env_file", line: null, preview: null },
        { kind: "secret", path: "a.js", secret: "aws_key", line: 3, preview: "AKIA…MPLE" },
        { kind: "secret", path: "a.js", secret: "github_token", line: 9, preview: "ghp_…6789" },
        { kind: "large_file", path: "clip.mov", mib: 70 },
      ]),
    ).toEqual([
      {
        kind: "secret",
        path: "app/.env",
        hits: [{ secret: "env_file", line: null, preview: null }],
        ignorePattern: ".env",
      },
      {
        kind: "secret",
        path: "a.js",
        hits: [
          { secret: "aws_key", line: 3, preview: "AKIA…MPLE" },
          { secret: "github_token", line: 9, preview: "ghp_…6789" },
        ],
        ignorePattern: null,
      },
      { kind: "large_file", path: "clip.mov", mib: 70 },
    ]);
  });
});

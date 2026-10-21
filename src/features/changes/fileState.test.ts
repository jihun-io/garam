import { describe, expect, it } from "vitest";

import type { FileChange } from "../../ipc";
import {
  checkState,
  combinedCheckState,
  displayKind,
  parseCoAuthors,
  splitPath,
} from "./fileState";

const file = (staged: FileChange["staged"], unstaged: FileChange["unstaged"]): FileChange => ({
  path: "a.txt",
  origPath: null,
  staged,
  unstaged,
  isSubmodule: false,
});

describe("displayKind", () => {
  it.each([
    [file(null, "untracked"), "added"],
    [file("added", "modified"), "added"],
    [file(null, "modified"), "modified"],
    [file("modified", "deleted"), "deleted"],
    [file("renamed", "modified"), "renamed"],
    [file("conflicted", "conflicted"), "conflicted"],
  ] as const)("%o -> %s", (f, kind) => {
    expect(displayKind(f)).toBe(kind);
  });
});

describe("checkState", () => {
  it("reflects what is staged", () => {
    expect(checkState(file(null, "modified"))).toBe("unchecked");
    expect(checkState(file("modified", null))).toBe("checked");
    expect(checkState(file("modified", "modified"))).toBe("mixed");
    expect(checkState(file("conflicted", "conflicted"))).toBe("unchecked");
  });

  it("combines several files", () => {
    expect(combinedCheckState([])).toBe("unchecked");
    expect(combinedCheckState([file("added", null), file("modified", null)])).toBe("checked");
    expect(combinedCheckState([file("added", null), file(null, "modified")])).toBe("mixed");
  });
});

describe("parseCoAuthors", () => {
  it("parses one per line and ignores blanks", () => {
    expect(parseCoAuthors("김가람 <garam@example.com>\n\n Lee <lee@x.io> ")).toEqual({
      ok: true,
      coAuthors: [
        { name: "김가람", email: "garam@example.com" },
        { name: "Lee", email: "lee@x.io" },
      ],
    });
    expect(parseCoAuthors("")).toEqual({ ok: true, coAuthors: [] });
  });

  it("rejects malformed lines", () => {
    expect(parseCoAuthors("just a name")).toEqual({ ok: false });
    expect(parseCoAuthors("<no@name.com>")).toEqual({ ok: false });
    expect(parseCoAuthors("Name <not an email>")).toEqual({ ok: false });
  });
});

describe("splitPath", () => {
  it("separates folder and name", () => {
    expect(splitPath("src/lib/파일.ts")).toEqual({ dir: "src/lib/", name: "파일.ts" });
    expect(splitPath("README.md")).toEqual({ dir: "", name: "README.md" });
  });
});

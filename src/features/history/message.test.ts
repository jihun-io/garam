import { describe, expect, it } from "vitest";

import { githubWebUrl, isBreaking, linkIssues, parseConventional, splitCoAuthors } from "./message";

describe("parseConventional", () => {
  it("reads type, scope and the breaking mark", () => {
    expect(parseConventional("fix(ui): say “just now”")).toEqual({
      type: "fix",
      scope: "ui",
      breaking: false,
      subject: "say “just now”",
    });
    expect(parseConventional("feat!: drop Node 18")).toEqual({
      type: "feat",
      scope: null,
      breaking: true,
      subject: "drop Node 18",
    });
    expect(parseConventional("Docs: 한글 문서")?.type).toBe("docs");
  });

  it("ignores summaries without a known prefix", () => {
    for (const summary of [
      "Merge pull request #12 from x/y",
      "Merge: x",
      "wip: stuff",
      "fix:missing space",
      "fix",
    ]) {
      expect(parseConventional(summary)).toBeNull();
    }
  });
});

describe("isBreaking", () => {
  it("sees the mark or a footer", () => {
    expect(isBreaking("feat!: x", "")).toBe(true);
    expect(isBreaking("feat: x", "Body.\n\nBREAKING CHANGE: config moved")).toBe(true);
    expect(isBreaking("feat: x", "Not a BREAKING CHANGE: mid-line")).toBe(false);
  });
});

describe("splitCoAuthors", () => {
  it("takes trailers out of the body", () => {
    expect(
      splitCoAuthors(
        "Explains.\n\nCo-authored-by: 김가람 <garam@example.com>\nco-authored-by: Bo <bo@example.com>",
      ),
    ).toEqual({
      body: "Explains.",
      coAuthors: [
        { name: "김가람", email: "garam@example.com" },
        { name: "Bo", email: "bo@example.com" },
      ],
    });
    expect(splitCoAuthors("Just text").coAuthors).toEqual([]);
  });
});

describe("linkIssues", () => {
  it("finds #123 references", () => {
    expect(linkIssues("Fixes #12 and (#3).")).toEqual([
      { text: "Fixes " },
      { issue: 12, text: "#12" },
      { text: " and (" },
      { issue: 3, text: "#3" },
      { text: ")." },
    ]);
    expect(linkIssues("#7")).toEqual([{ issue: 7, text: "#7" }]);
  });

  it("leaves other hashes alone", () => {
    expect(linkIssues("a#1 &#39; x/#2 ##3 #abc")).toEqual([{ text: "a#1 &#39; x/#2 ##3 #abc" }]);
  });
});

describe("githubWebUrl", () => {
  it("reads github.com remotes", () => {
    for (const url of [
      "https://github.com/jihun-io/garam.git",
      "https://jihun-io@github.com/jihun-io/garam",
      "git@github.com:jihun-io/garam.git",
      "ssh://git@github.com/jihun-io/garam.git",
    ]) {
      expect(githubWebUrl(url)).toBe("https://github.com/jihun-io/garam");
    }
    expect(githubWebUrl("git@gitlab.com:a/b.git")).toBeNull();
  });
});

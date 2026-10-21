import { describe, expect, it } from "vitest";

import { displayPath, joinPath, repoNameFromUrl } from "./paths";

describe("repoNameFromUrl", () => {
  it.each([
    ["https://github.com/owner/garam.git", "garam"],
    ["https://github.com/owner/garam", "garam"],
    ["https://github.com/owner/garam/", "garam"],
    ["git@github.com:owner/garam.git", "garam"],
    ["ssh://git@host:22/owner/garam.git", "garam"],
    ["/srv/repos/project.git", "project"],
    ["C:\\repos\\project", "project"],
    ["  https://gitlab.com/group/sub/app.GIT  ", "app"],
    ["", ""],
  ])("%s -> %s", (url, name) => {
    expect(repoNameFromUrl(url)).toBe(name);
  });
});

describe("joinPath", () => {
  it("uses the directory's separator", () => {
    expect(joinPath("/Users/me/Developer", "garam")).toBe("/Users/me/Developer/garam");
    expect(joinPath("/Users/me/", "garam")).toBe("/Users/me/garam");
    expect(joinPath("C:\\Users\\me", "garam")).toBe("C:\\Users\\me\\garam");
  });
});

describe("displayPath", () => {
  it("abbreviates home folders", () => {
    expect(displayPath("/Users/jihun/Developer/garam")).toBe("~/Developer/garam");
    expect(displayPath("/home/jihun/garam")).toBe("~/garam");
    expect(displayPath("C:\\Users\\jihun\\garam")).toBe("~\\garam");
    expect(displayPath("/Users/jihun")).toBe("~");
    expect(displayPath("/opt/repos/garam")).toBe("/opt/repos/garam");
  });
});

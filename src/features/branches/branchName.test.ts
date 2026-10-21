import { describe, expect, it } from "vitest";

import { relativeTime } from "../../lib/time";
import { sanitizeBranchName } from "./branchName";

describe("sanitizeBranchName", () => {
  it.each([
    ["my feature", "my-feature"],
    ["  로그인 화면 개선 ", "로그인-화면-개선"],
    ["fix: crash?", "fix-crash"],
    ["a..b", "a.b"],
    ["-leading", "leading"],
    ["feature//x/", "feature/x"],
    ["release.lock", "release"],
    ["ok-name", "ok-name"],
  ])("%s -> %s", (input, output) => {
    expect(sanitizeBranchName(input)).toBe(output);
  });
});

describe("relativeTime", () => {
  const now = Date.UTC(2026, 0, 10);
  it("formats in the given language", () => {
    expect(relativeTime(now / 1000 - 3 * 24 * 3600, "en", now)).toBe("3 days ago");
    expect(relativeTime(now / 1000 - 3 * 24 * 3600, "ko", now)).toBe("3일 전");
    expect(relativeTime(now / 1000 - 10, "en", now)).toBe("this minute");
  });
});

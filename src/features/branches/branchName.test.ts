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
    expect(relativeTime(now / 1000 - 3 * 24 * 3600, "en", "just now", now)).toBe("3 days ago");
    expect(relativeTime(now / 1000 - 3 * 24 * 3600, "ko", "방금 전", now)).toBe("3일 전");
    expect(relativeTime(now / 1000 - 120, "ko", "방금 전", now)).toBe("2분 전");
  });

  it('says just now under a minute, instead of Intl\'s "this minute"', () => {
    expect(relativeTime(now / 1000 - 10, "en", "just now", now)).toBe("just now");
    expect(relativeTime(now / 1000 - 59, "ko", "방금 전", now)).toBe("방금 전");
  });
});

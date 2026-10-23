import { describe, expect, it } from "vitest";

import type { BaseStatus } from "../../ipc";
import { shouldNotify } from "./baseNotice";

const status = (behind: number, conflicts: string[] | null = []): BaseStatus => ({
  base: "origin/main",
  baseBranch: "main",
  behind,
  conflicts,
  published: true,
});

describe("shouldNotify", () => {
  it("speaks up for conflicts or a long way behind, not for every move", () => {
    expect(shouldNotify(status(0))).toBe(false);
    expect(shouldNotify(status(3))).toBe(false);
    expect(shouldNotify(status(3, ["a.ts"]))).toBe(true);
    expect(shouldNotify(status(10))).toBe(true);
    // Unknown conflicts (old git) still count the commits.
    expect(shouldNotify(status(12, null))).toBe(true);
  });

  it("comes back after Later only for something new", () => {
    const later = { conflicts: ["a.ts"], behind: 4 };
    expect(shouldNotify(status(6, ["a.ts"]), later)).toBe(false);
    expect(shouldNotify(status(6, ["a.ts", "b.ts"]), later)).toBe(true);
    expect(shouldNotify(status(14, ["a.ts"]), later)).toBe(true);
  });
});

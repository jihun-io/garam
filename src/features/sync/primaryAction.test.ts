import { describe, expect, it } from "vitest";

import type { BranchStatus } from "../../ipc";
import { hasUpstream, primaryAction } from "./primaryAction";

const status = (extra: Partial<BranchStatus> = {}): BranchStatus => ({
  head: "main",
  oid: "abc",
  upstream: "origin/main",
  ahead: 0,
  behind: 0,
  ...extra,
});

describe("primaryAction", () => {
  it("fetches when in sync or detached", () => {
    expect(primaryAction(status(), false)).toEqual({ action: "fetch" });
    expect(primaryAction(status({ head: null, upstream: null }), false)).toEqual({
      action: "fetch",
    });
  });

  it("pulls before pushing when both sides moved", () => {
    expect(primaryAction(status({ behind: 2, ahead: 1 }), false)).toEqual({ action: "pull" });
    expect(primaryAction(status({ ahead: 1 }), false)).toEqual({ action: "push" });
  });

  it("publishes branches without a live upstream", () => {
    expect(primaryAction(status({ upstream: null }), false)).toEqual({
      action: "publish",
      disabled: false,
    });
    expect(primaryAction(status(), true)).toEqual({ action: "publish", disabled: false });
    expect(primaryAction(status({ upstream: null, oid: null }), false)).toEqual({
      action: "publish",
      disabled: true,
    });
  });

  it("knows when pull and push are possible", () => {
    expect(hasUpstream(status(), false)).toBe(true);
    expect(hasUpstream(status(), true)).toBe(false);
    expect(hasUpstream(status({ upstream: null }), false)).toBe(false);
  });
});

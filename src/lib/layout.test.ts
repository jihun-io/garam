import { afterEach, describe, expect, it, vi } from "vitest";

import { clampSidebarWidth, maxSidebarWidth } from "./layout";

describe("sidebar width", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("leaves room for the toolbar and diff in narrow windows", () => {
    vi.stubGlobal("innerWidth", 800);
    expect(maxSidebarWidth()).toBe(320);
    expect(clampSidebarWidth(500)).toBe(320);
    expect(clampSidebarWidth(100)).toBe(256);
  });

  it("caps the width in wide windows", () => {
    vi.stubGlobal("innerWidth", 2560);
    expect(clampSidebarWidth(2000)).toBe(560);
    expect(clampSidebarWidth(333.6)).toBe(334);
  });
});

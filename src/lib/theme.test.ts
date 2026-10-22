import { afterEach, describe, expect, it, vi } from "vitest";

function fakeSystem(dark: boolean) {
  const listeners: (() => void)[] = [];
  const media = {
    matches: dark,
    addEventListener: (_: string, fn: () => void) => listeners.push(fn),
  };
  vi.stubGlobal("matchMedia", () => media);
  return {
    change(next: boolean) {
      media.matches = next;
      listeners.forEach((fn) => fn());
    },
  };
}

describe("theme", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("follows the system until a theme is chosen", async () => {
    const system = fakeSystem(true);
    const { initTheme, setThemePreference } = await import("./theme");
    initTheme();
    expect(document.documentElement.dataset.theme).toBe("dark");

    system.change(false);
    expect(document.documentElement.dataset.theme).toBe("light");

    setThemePreference("dark");
    system.change(false);
    expect(document.documentElement.dataset.theme).toBe("dark");

    setThemePreference("system");
    expect(document.documentElement.dataset.theme).toBe("light");
  });
});

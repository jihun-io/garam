import { describe, expect, it } from "vitest";

import { ACCENT_PRESETS, accentPairFrom, accentTokens, contrast, parseHex } from "./accent";

const LIGHT_SURFACE = parseHex("#fbfcfb")!;
const DARK_SURFACE = parseHex("#1c2428")!;

describe("accent colors", () => {
  it("keeps every preset readable on both themes", () => {
    for (const [name, pair] of Object.entries(ACCENT_PRESETS)) {
      expect(contrast(parseHex(pair.light)!, LIGHT_SURFACE), `${name} light`).toBeGreaterThan(4.5);
      expect(contrast(parseHex(pair.dark)!, DARK_SURFACE), `${name} dark`).toBeGreaterThan(4.5);
    }
  });

  it("adjusts system colors that are too light or too dark", () => {
    // macOS yellow is far too light for text on a light background.
    const yellow = accentPairFrom("#ffc600")!;
    expect(contrast(parseHex(yellow.light)!, LIGHT_SURFACE)).toBeGreaterThanOrEqual(4.5);
    expect(yellow.dark).toBe("#ffc600");

    const navy = accentPairFrom("#0b1d4f")!;
    expect(navy.light).toBe("#0b1d4f");
    expect(contrast(parseHex(navy.dark)!, DARK_SURFACE)).toBeGreaterThanOrEqual(4.5);

    expect(accentPairFrom("not a color")).toBeNull();
  });

  it("picks readable text for accent-colored buttons", () => {
    expect(accentTokens(ACCENT_PRESETS.garam.light, false)["--color-on-accent"]).toBe("#ffffff");
    expect(accentTokens(ACCENT_PRESETS.garam.dark, true)["--color-on-accent"]).toBe("#10161a");
    expect(accentTokens("#2463c7", false)["--color-selected"]).toBe("rgba(36, 99, 199, 0.12)");
  });
});

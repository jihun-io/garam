import { describe, expect, it } from "vitest";

import { contrast, parseHex, type Rgb } from "../lib/accent";
import tokensCss from "./tokens.css?raw";

/** `--color-*` values of the first block whose selector matches. */
function block(selector: string): Record<string, string> {
  const start = tokensCss.indexOf(`${selector} {`);
  const body = tokensCss.slice(start, tokensCss.indexOf("}", start));
  return Object.fromEntries(
    [...body.matchAll(/--(color-[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]),
  );
}

/** A hex color, or an rgba() one laid over `under`. */
function resolve(value: string, under?: Rgb): Rgb {
  const hex = parseHex(value);
  if (hex) return hex;
  const [r, g, b, a] = value.slice(5, -1).split(",").map(Number);
  if (!under) throw new Error(`${value} needs a background`);
  return [r, g, b].map((c, i) => c * a + under[i] * (1 - a)) as Rgb;
}

const light = block(":root");
const themes = { light, dark: { ...light, ...block(':root[data-theme="dark"]') } };

// Text colors and every background they appear on (docs/UI.md 4.6).
const TEXT = ["ink", "ink-muted", "link", "danger", "added-ink", "modified-ink"];

describe.each(Object.entries(themes))("%s theme text", (_, tokens) => {
  const color = (name: string, under?: Rgb) => resolve(tokens[`color-${name}`], under);
  const bg = color("bg");
  const surface = color("surface");
  const backgrounds: Record<string, Rgb> = {
    bg,
    surface,
    raised: color("raised"),
    hover: color("hover", surface),
    selected: color("selected", bg),
    "added-bg": color("added-bg"),
    "deleted-bg": color("deleted-bg"),
    "hunk-bg": color("hunk-bg"),
  };

  it.each(TEXT)("%s meets WCAG AA (4.5:1) on every background", (name) => {
    const failing = Object.entries(backgrounds)
      .map(([where, back]) => [where, contrast(color(name), back)] as const)
      .filter(([, ratio]) => ratio < 4.5)
      .map(([where, ratio]) => `${where} ${ratio.toFixed(2)}`);
    expect(failing).toEqual([]);
  });
});

// Accent colors (docs/UI.md 4.6). Every accent gets a light-theme and a
// dark-theme variant that keep text readable (WCAG AA, 4.5:1) on the app's
// surfaces, plus the tokens derived from it.

export type Rgb = [number, number, number];

export function parseHex(hex: string): Rgb | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function toHex([r, g, b]: Rgb): string {
  return `#${[r, g, b].map((c) => Math.round(c).toString(16).padStart(2, "0")).join("")}`;
}

function luminance([r, g, b]: Rgb): number {
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

function mix(color: Rgb, toward: Rgb, amount: number): Rgb {
  return color.map((c, i) => c + (toward[i] - c) * amount) as Rgb;
}

const WHITE: Rgb = [255, 255, 255];
const BLACK: Rgb = [0, 0, 0];
/** `--color-surface` of each theme, the background accents sit on most. */
const LIGHT_SURFACE: Rgb = [0xfc, 0xfd, 0xfe];
const DARK_SURFACE: Rgb = [0x12, 0x13, 0x14];
/** `--color-bg` of each theme, under selected rows. */
const LIGHT_BG: Rgb = [0xf2, 0xf3, 0xf5];
const DARK_BG: Rgb = [0x18, 0x19, 0x1b];
const DARK_INK: Rgb = [0x10, 0x16, 0x1a];
const MIN_CONTRAST = 4.5;

/** Moves `color` toward `toward` until it contrasts enough with `against`. */
function untilReadable(color: Rgb, against: Rgb, toward: Rgb): Rgb {
  let result = color;
  for (let step = 1; contrast(result, against) < MIN_CONTRAST && step <= 20; step++) {
    result = mix(color, toward, step * 0.05);
  }
  return result;
}

export type AccentPair = { light: string; dark: string };

/** Hand-tuned accents offered in settings. */
export const ACCENT_PRESETS = {
  garam: { light: "#2c7a6b", dark: "#5db3a0" },
  blue: { light: "#2463c7", dark: "#6aa5f5" },
  purple: { light: "#7148b8", dark: "#b39af0" },
  pink: { light: "#b8366e", dark: "#f08cb6" },
  orange: { light: "#b4530f", dark: "#f2a35b" },
} as const satisfies Record<string, AccentPair>;

/** Light and dark variants of an arbitrary color, such as the system's. */
export function accentPairFrom(hex: string): AccentPair | null {
  const rgb = parseHex(hex);
  if (!rgb) return null;
  return {
    light: toHex(untilReadable(rgb, LIGHT_SURFACE, BLACK)),
    dark: toHex(untilReadable(rgb, DARK_SURFACE, WHITE)),
  };
}

export type AccentTokens = {
  "--color-river": string;
  "--color-river-strong": string;
  "--color-focus": string;
  "--color-selected": string;
  "--color-on-accent": string;
};

/** CSS tokens for `accent` (already the variant for `dark` or light). */
export function accentTokens(accent: string, dark: boolean): AccentTokens {
  const rgb = parseHex(accent) ?? [0x2c, 0x7a, 0x6b];
  const strong = dark ? mix(rgb, WHITE, 0.25) : mix(rgb, BLACK, 0.2);
  const onAccent = contrast(rgb, WHITE) >= contrast(rgb, DARK_INK) ? WHITE : DARK_INK;
  return {
    "--color-river": toHex(rgb),
    "--color-river-strong": toHex(strong),
    "--color-focus": toHex(rgb),
    // Opaque, so a selected row looks the same on any surface.
    "--color-selected": toHex(mix(dark ? DARK_BG : LIGHT_BG, rgb, dark ? 0.22 : 0.14)),
    "--color-on-accent": toHex(onAccent),
  };
}

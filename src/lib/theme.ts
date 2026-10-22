import { ACCENT_PRESETS, accentTokens, type AccentPair } from "./accent";

export type ThemePreference = "system" | "light" | "dark";
export type DiffFontSize = "small" | "medium" | "large";

export type Appearance = {
  theme: ThemePreference;
  /** Light and dark variants of the accent color. */
  accent: AccentPair;
  diffFontSize: DiffFontSize;
};

const DIFF_FONT_SIZES: Record<DiffFontSize, string> = {
  small: "11px",
  medium: "12px",
  large: "14px",
};

let appearance: Appearance = {
  theme: "system",
  accent: ACCENT_PRESETS.garam,
  diffFontSize: "medium",
};
const systemDark =
  typeof window !== "undefined" && window.matchMedia
    ? window.matchMedia("(prefers-color-scheme: dark)")
    : null;

/**
 * Sets `data-theme` on <html> (resolving "system" to light or dark) and the
 * accent and diff font tokens for that theme.
 */
function apply() {
  const dark =
    appearance.theme === "dark" || (appearance.theme === "system" && !!systemDark?.matches);
  const root = document.documentElement;
  root.dataset.theme = dark ? "dark" : "light";
  const tokens = accentTokens(dark ? appearance.accent.dark : appearance.accent.light, dark);
  for (const [name, value] of Object.entries(tokens)) root.style.setProperty(name, value);
  root.style.setProperty("--diff-font-size", DIFF_FONT_SIZES[appearance.diffFontSize]);
}

export function setAppearance(next: Partial<Appearance>) {
  appearance = { ...appearance, ...next };
  apply();
}

export function setThemePreference(theme: ThemePreference) {
  setAppearance({ theme });
}

/** Applies the appearance now and follows system changes while on "system". */
export function initTheme() {
  systemDark?.addEventListener("change", apply);
  apply();
}

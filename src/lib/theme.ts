export type ThemePreference = "system" | "light" | "dark";

let preference: ThemePreference = "system";
const systemDark =
  typeof window !== "undefined" && window.matchMedia
    ? window.matchMedia("(prefers-color-scheme: dark)")
    : null;

/** Sets `data-theme` on <html>, resolving "system" to light or dark. */
function apply() {
  const dark = preference === "dark" || (preference === "system" && !!systemDark?.matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}

export function setThemePreference(next: ThemePreference) {
  preference = next;
  apply();
}

/** Applies the theme now and follows system changes while on "system". */
export function initTheme() {
  systemDark?.addEventListener("change", apply);
  apply();
}

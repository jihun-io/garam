import { useTranslation } from "react-i18next";

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 24 * 3600],
  ["month", 30 * 24 * 3600],
  ["week", 7 * 24 * 3600],
  ["day", 24 * 3600],
  ["hour", 3600],
  ["minute", 60],
];

/**
 * "3 days ago" / "3일 전" for a Unix timestamp in seconds. Under a minute
 * gives `justNow`: Intl's own wording there ("this minute", "현재 분")
 * reads oddly.
 */
export function relativeTime(
  seconds: number,
  locale: string,
  justNow: string,
  now = Date.now(),
): string {
  const diff = seconds - now / 1000;
  const format = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  for (const [unit, size] of UNITS) {
    if (Math.abs(diff) >= size) return format.format(Math.round(diff / size), unit);
  }
  return justNow;
}

/** {@link relativeTime} in the app's language. */
export function useRelativeTime(): (seconds: number) => string {
  const { t, i18n } = useTranslation("common");
  return (seconds) => relativeTime(seconds, i18n.language, t("time.justNow"));
}

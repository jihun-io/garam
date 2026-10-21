export type Platform = "macos" | "windows" | "linux";

export function currentPlatform(): Platform {
  const ua = navigator.userAgent;
  if (ua.includes("Mac")) return "macos";
  if (ua.includes("Windows")) return "windows";
  return "linux";
}

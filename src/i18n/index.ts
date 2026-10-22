import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import enBranches from "../locales/en/branches.json";
import enChanges from "../locales/en/changes.json";
import enCommon from "../locales/en/common.json";
import enConflicts from "../locales/en/conflicts.json";
import enCredentials from "../locales/en/credentials.json";
import enErrors from "../locales/en/errors.json";
import enHistory from "../locales/en/history.json";
import enRepos from "../locales/en/repos.json";
import enSettings from "../locales/en/settings.json";
import enStartup from "../locales/en/startup.json";
import enSync from "../locales/en/sync.json";
import koBranches from "../locales/ko/branches.json";
import koChanges from "../locales/ko/changes.json";
import koCommon from "../locales/ko/common.json";
import koConflicts from "../locales/ko/conflicts.json";
import koCredentials from "../locales/ko/credentials.json";
import koErrors from "../locales/ko/errors.json";
import koHistory from "../locales/ko/history.json";
import koRepos from "../locales/ko/repos.json";
import koSettings from "../locales/ko/settings.json";
import koStartup from "../locales/ko/startup.json";
import koSync from "../locales/ko/sync.json";

export const resources = {
  en: {
    branches: enBranches,
    changes: enChanges,
    common: enCommon,
    conflicts: enConflicts,
    credentials: enCredentials,
    errors: enErrors,
    history: enHistory,
    repos: enRepos,
    settings: enSettings,
    startup: enStartup,
    sync: enSync,
  },
  ko: {
    branches: koBranches,
    changes: koChanges,
    common: koCommon,
    conflicts: koConflicts,
    credentials: koCredentials,
    errors: koErrors,
    history: koHistory,
    repos: koRepos,
    settings: koSettings,
    startup: koStartup,
    sync: koSync,
  },
} as const;

export type Language = keyof typeof resources;

/** Languages shown in the picker, each labelled in its own language. */
export const LANGUAGES: { code: Language; label: string }[] = [
  { code: "ko", label: "한국어" },
  { code: "en", label: "English" },
];

export function isLanguage(value: unknown): value is Language {
  return typeof value === "string" && value in resources;
}

/** The system language if Garam has it, otherwise English. */
export function systemLanguage(): Language {
  const system = navigator.language.split("-")[0];
  return isLanguage(system) ? system : "en";
}

/** The UI language for the saved setting; `null` follows the system. */
export function resolveLanguage(saved: string | null): Language {
  return isLanguage(saved) ? saved : systemLanguage();
}

// Where the language was kept before settings.json existed.
const LEGACY_STORAGE_KEY = "garam.language";

/** Returns and forgets a language saved by older versions, to migrate it. */
export function takeLegacyLanguage(): Language | null {
  try {
    const saved = localStorage.getItem(LEGACY_STORAGE_KEY);
    localStorage.removeItem(LEGACY_STORAGE_KEY);
    return isLanguage(saved) ? saved : null;
  } catch {
    return null;
  }
}

i18n.on("languageChanged", (language) => {
  document.documentElement.lang = language;
});

void i18n.use(initReactI18next).init({
  resources,
  lng: systemLanguage(),
  fallbackLng: "en",
  defaultNS: "common",
  ns: [
    "branches",
    "changes",
    "common",
    "credentials",
    "errors",
    "history",
    "repos",
    "startup",
    "sync",
  ],
  interpolation: { escapeValue: false },
  contextSeparator: "#",
  returnNull: false,
});

export default i18n;

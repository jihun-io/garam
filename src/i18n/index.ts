import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import enBranches from "../locales/en/branches.json";
import enChanges from "../locales/en/changes.json";
import enCommon from "../locales/en/common.json";
import enCredentials from "../locales/en/credentials.json";
import enErrors from "../locales/en/errors.json";
import enRepos from "../locales/en/repos.json";
import enStartup from "../locales/en/startup.json";
import enSync from "../locales/en/sync.json";
import koBranches from "../locales/ko/branches.json";
import koChanges from "../locales/ko/changes.json";
import koCommon from "../locales/ko/common.json";
import koCredentials from "../locales/ko/credentials.json";
import koErrors from "../locales/ko/errors.json";
import koRepos from "../locales/ko/repos.json";
import koStartup from "../locales/ko/startup.json";
import koSync from "../locales/ko/sync.json";

export const resources = {
  en: {
    branches: enBranches,
    changes: enChanges,
    common: enCommon,
    credentials: enCredentials,
    errors: enErrors,
    repos: enRepos,
    startup: enStartup,
    sync: enSync,
  },
  ko: {
    branches: koBranches,
    changes: koChanges,
    common: koCommon,
    credentials: koCredentials,
    errors: koErrors,
    repos: koRepos,
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

// TODO(M8): move to the persisted settings store once it exists.
const STORAGE_KEY = "garam.language";

function isLanguage(value: unknown): value is Language {
  return typeof value === "string" && value in resources;
}

export function detectLanguage(): Language {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (isLanguage(saved)) return saved;
  } catch {
    // Storage unavailable; fall through to the system language.
  }
  const system = navigator.language.split("-")[0];
  return isLanguage(system) ? system : "en";
}

export function changeLanguage(language: Language) {
  try {
    localStorage.setItem(STORAGE_KEY, language);
  } catch {
    // Not persisted; the choice still applies for this session.
  }
  return i18n.changeLanguage(language);
}

i18n.on("languageChanged", (language) => {
  document.documentElement.lang = language;
});

void i18n.use(initReactI18next).init({
  resources,
  lng: detectLanguage(),
  fallbackLng: "en",
  defaultNS: "common",
  ns: ["branches", "changes", "common", "credentials", "errors", "repos", "startup", "sync"],
  interpolation: { escapeValue: false },
  contextSeparator: "#",
  returnNull: false,
});

export default i18n;

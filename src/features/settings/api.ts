import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";

import { commands, unwrap, type AppSettings, type GlobalKey, type GlobalSettings } from "../../ipc";
import { useNotify } from "../notify/notifyStore";

export const settingsKeys = {
  app: ["settings"] as const,
  gitGlobal: ["settings", "git-global"] as const,
  systemAccent: ["settings", "system-accent"] as const,
  terminals: ["external", "terminals"] as const,
};

/** Defaults matching Rust's `AppSettings::default`, for before loading. */
export const DEFAULT_SETTINGS: AppSettings = {
  language: null,
  theme: "system",
  accent: "system",
  diffFontSize: "medium",
  editor: null,
  terminal: null,
  fetchIntervalMinutes: 5,
  sidebarWidth: 320,
};

export function useSettings(): AppSettings {
  const query = useQuery({
    queryKey: settingsKeys.app,
    queryFn: () => commands.settingsGet(),
    staleTime: Infinity,
  });
  return query.data ?? DEFAULT_SETTINGS;
}

/** Saves a change right away; the UI updates before the write finishes. */
export function useUpdateSettings() {
  const client = useQueryClient();
  const showError = useNotify((s) => s.showError);
  const mutation = useMutation({
    mutationFn: (next: AppSettings) => unwrap(commands.settingsSet(next)),
    onMutate: (next) => {
      const previous = client.getQueryData<AppSettings>(settingsKeys.app);
      client.setQueryData(settingsKeys.app, next);
      return previous;
    },
    onError: (error, _next, previous) => {
      client.setQueryData(settingsKeys.app, previous);
      showError(error);
    },
    scope: { id: "settings" },
  });
  return (patch: Partial<AppSettings>) => {
    const current = client.getQueryData<AppSettings>(settingsKeys.app) ?? DEFAULT_SETTINGS;
    mutation.mutate({ ...current, ...patch });
  };
}

// The language the app started with; macOS's own menus keep it until the
// next launch.
let launchLanguage: string | null = null;

export function rememberLaunchLanguage(language: string | null) {
  launchLanguage = language;
}

export function getLaunchLanguage() {
  return launchLanguage;
}

/** Loads settings into the cache before the first render. */
export async function preloadSettings(client: QueryClient): Promise<AppSettings> {
  try {
    const settings = await commands.settingsGet();
    client.setQueryData(settingsKeys.app, settings);
    return settings;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

/** The system accent color; re-read when the window regains focus. */
export function useSystemAccent(enabled: boolean) {
  return useQuery({
    queryKey: settingsKeys.systemAccent,
    queryFn: () => unwrap(commands.systemAccentColor()),
    enabled,
    refetchOnWindowFocus: true,
  });
}

export function useGitGlobal() {
  return useQuery({
    queryKey: settingsKeys.gitGlobal,
    queryFn: () => unwrap(commands.gitGlobalGet()),
  });
}

export function useSetGitGlobal() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ key, value }: { key: GlobalKey; value: string }) =>
      unwrap(commands.gitGlobalSet(key, value)),
    onSuccess: (_, { key, value }) => {
      const field: Record<GlobalKey, keyof GlobalSettings> = {
        user_name: "userName",
        user_email: "userEmail",
        default_branch: "defaultBranch",
      };
      client.setQueryData<GlobalSettings>(settingsKeys.gitGlobal, (old) =>
        old ? { ...old, [field[key]]: value.trim() || null } : old,
      );
      // The author shown for repositories may have changed.
      void client.invalidateQueries({ queryKey: ["repo"] });
    },
  });
}

export function useTerminals() {
  return useQuery({
    queryKey: settingsKeys.terminals,
    queryFn: () => unwrap(commands.externalTerminals()),
    staleTime: 5 * 60_000,
  });
}

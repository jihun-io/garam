import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { commands, unwrap, type ExternalEditor, type RepositoryEntry } from "../../ipc";
import type { CommandId } from "../../lib/commands";
import { useSettings, useTerminals } from "../settings/api";

export const REPOSITORIES = ["repositories"] as const;

const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });

export function sortRepositories(repos: RepositoryEntry[]): RepositoryEntry[] {
  return [...repos].sort((a, b) => collator.compare(a.name, b.name));
}

export function useRepositories() {
  return useQuery({
    queryKey: REPOSITORIES,
    queryFn: () => commands.repoList(),
    // Another window may have added or removed one.
    refetchOnWindowFocus: true,
    select: (list) => {
      const repositories = sortRepositories(list.repositories);
      const selected =
        repositories.find((r) => r.path === list.selected) ?? repositories[0] ?? null;
      return { repositories, selected };
    },
  });
}

/** Mutations that change the repository list, refreshing it afterwards. */
export function useRepositoryActions() {
  const client = useQueryClient();
  const refresh = () => client.invalidateQueries({ queryKey: REPOSITORIES });
  const options = { onSettled: refresh };

  return {
    add: useMutation({ mutationFn: (path: string) => unwrap(commands.repoAdd(path)), ...options }),
    initExisting: useMutation({
      mutationFn: (path: string) => unwrap(commands.repoInitExisting(path)),
      ...options,
    }),
    create: useMutation({
      mutationFn: ({ parent, name }: { parent: string; name: string }) =>
        unwrap(commands.repoCreate(parent, name)),
      ...options,
    }),
    remove: useMutation({
      mutationFn: (path: string) => unwrap(commands.repoRemove(path)),
      ...options,
    }),
    select: useMutation({
      mutationFn: (path: string) => unwrap(commands.repoSelect(path)),
      ...options,
    }),
    setAccount: useMutation({
      mutationFn: ({ path, account }: { path: string; account: string | null }) =>
        unwrap(commands.repoSetAccount(path, account)),
      ...options,
    }),
    setEditor: useMutation({
      mutationFn: ({ path, editor }: { path: string; editor: string | null }) =>
        unwrap(commands.repoSetEditor(path, editor)),
      ...options,
    }),
  };
}

export function useEditors() {
  return useQuery({
    queryKey: ["external", "editors"],
    queryFn: () => unwrap(commands.externalEditors()),
    staleTime: 5 * 60_000,
  });
}

/** Ids of the editors suited to the repository's kind of project. */
function useSuggestedEditors(path: string) {
  return useQuery({
    queryKey: ["external", "suggestedEditors", path],
    queryFn: () => unwrap(commands.externalSuggestedEditors(path)),
    staleTime: 5 * 60_000,
  });
}

/**
 * Which editor "Open in editor" uses for the repository at `path`: the
 * repository's own choice, else the one in settings, else the first found
 * (an uninstalled choice falls through). `editors` lists that one first,
 * then the ones suited to the repository, then the rest.
 */
export function useRepoEditor(path: string) {
  const settings = useSettings();
  const detected = useEditors().data ?? [];
  const repoChoice =
    useRepositories().data?.repositories.find((r) => r.path === path)?.editor ?? null;
  const suggested = useSuggestedEditors(path).data ?? [];

  const byId = (id: string | null) => detected.find((e) => e.id === id);
  const fromSettings = byId(settings.editor) ?? detected[0];
  const editor = byId(repoChoice) ?? fromSettings;
  const rank = (e: ExternalEditor) => (e === editor ? 0 : suggested.includes(e.id) ? 1 : 2);
  const editors = [...detected].sort((a, b) => rank(a) - rank(b));
  return {
    editor,
    editors,
    /** Editors suited to this repository, other than `editor`. */
    suggested: editors.filter((e) => rank(e) === 1),
    /** The repository's own choice, if it is installed. */
    repoChoice: byId(repoChoice)?.id ?? null,
    fromSettings,
    /** Every installed editor, in the fixed order settings lists them. */
    installed: detected,
  };
}

/**
 * Labels naming the app that "Open in editor/terminal" would launch, so the
 * buttons say "Open in Visual Studio Code" rather than a generic "Editor".
 */
export function useOpenInLabels(path: string): Partial<Record<CommandId, string>> {
  const { t } = useTranslation("repos");
  const settings = useSettings();
  const { editor } = useRepoEditor(path);
  const terminals = useTerminals().data ?? [];
  // Opening falls back to the first one found, too.
  const terminal = terminals.find((app) => app.id === settings.terminal) ?? terminals[0];
  return {
    ...(editor && { "repo.openEditor": t("open.inApp", { name: editor.name }) }),
    ...(terminal && { "repo.openTerminal": t("open.inApp", { name: terminal.name }) }),
  };
}

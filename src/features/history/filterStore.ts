import { useEffect, useMemo, useState } from "react";
import { create } from "zustand";

import type { HistoryFilter } from "../../ipc";

export const DEFAULT_FILTER: HistoryFilter = {
  scope: { kind: "head" },
  query: "",
  searchIn: "message",
  path: "",
  firstParent: false,
};

/** The history filter per repository, kept while switching tabs. */
export const useHistoryFilters = create<{
  filters: Record<string, HistoryFilter>;
  update: (repo: string, patch: Partial<HistoryFilter>) => void;
  reset: (repo: string) => void;
}>((set) => ({
  filters: {},
  update: (repo, patch) =>
    set((s) => ({
      filters: { ...s.filters, [repo]: { ...(s.filters[repo] ?? DEFAULT_FILTER), ...patch } },
    })),
  reset: (repo) => set((s) => ({ filters: { ...s.filters, [repo]: DEFAULT_FILTER } })),
}));

export function useHistoryFilter(repo: string): HistoryFilter {
  return useHistoryFilters((s) => s.filters[repo] ?? DEFAULT_FILTER);
}

/** Narrowed by something other than the search text (shown on the filter button). */
export function hasFilters(filter: HistoryFilter): boolean {
  return filter.scope.kind !== "head" || filter.path.trim() !== "" || filter.firstParent;
}

/** Shows HEAD's plain history: nothing searched or filtered. */
export function isUnfiltered(filter: HistoryFilter): boolean {
  return filter.query.trim() === "" && !hasFilters(filter);
}

/**
 * `filter` with typed text settled for `delay` ms, so each keystroke doesn't
 * run git. Clearing a field takes effect at once.
 */
export function useSettledFilter(filter: HistoryFilter, delay = 300): HistoryFilter {
  const { query, path } = filter;
  const [text, setText] = useState({ query, path });
  useEffect(() => {
    const timer = setTimeout(() => setText({ query, path }), delay);
    return () => clearTimeout(timer);
  }, [query, path, delay]);
  return useMemo(
    () => ({
      ...filter,
      query: filter.query && text.query,
      path: filter.path && text.path,
    }),
    [filter, text],
  );
}

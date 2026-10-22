import { create } from "zustand";

/** How commit diffs are shown; kept while browsing commits. */
export const useDiffOptions = create<{
  ignoreWhitespace: boolean;
  setIgnoreWhitespace: (value: boolean) => void;
}>((set) => ({
  ignoreWhitespace: false,
  setIgnoreWhitespace: (ignoreWhitespace) => set({ ignoreWhitespace }),
}));

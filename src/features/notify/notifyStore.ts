import { create } from "zustand";

import { toAppError, type AppError } from "../../ipc";

function isAppError(value: unknown): value is AppError {
  return typeof value === "object" && value !== null && "kind" in value && "params" in value;
}

export type Notice =
  | { type: "error"; error: AppError }
  /** Already-translated text. */
  | { type: "info"; message: string };

/** One-at-a-time notice for actions that have no form to show it in. */
export const useNotify = create<{
  notice: Notice | null;
  showError: (error: unknown) => void;
  showInfo: (message: string) => void;
  dismiss: () => void;
}>((set) => ({
  notice: null,
  showError: (error) =>
    set({ notice: { type: "error", error: isAppError(error) ? error : toAppError(error) } }),
  showInfo: (message) => set({ notice: { type: "info", message } }),
  dismiss: () => set({ notice: null }),
}));

import { create } from "zustand";

import { toAppError, type AppError } from "../../ipc";

function isAppError(value: unknown): value is AppError {
  return typeof value === "object" && value !== null && "kind" in value && "params" in value;
}

/** A button on a notice, e.g. to undo what it reports. */
export type NoticeAction = { label: string; run: () => void };

export type Notice =
  | { type: "error"; error: AppError }
  /** Already-translated text. */
  | { type: "info"; message: string; action?: NoticeAction };

/** One-at-a-time notice for actions that have no form to show it in. */
export const useNotify = create<{
  notice: Notice | null;
  showError: (error: unknown) => void;
  showInfo: (message: string, action?: NoticeAction) => void;
  dismiss: () => void;
}>((set) => ({
  notice: null,
  showError: (error) =>
    set({ notice: { type: "error", error: isAppError(error) ? error : toAppError(error) } }),
  showInfo: (message, action) => set({ notice: { type: "info", message, action } }),
  dismiss: () => set({ notice: null }),
}));

import { create } from "zustand";

import { toAppError, type AppError } from "../../ipc";

function isAppError(value: unknown): value is AppError {
  return typeof value === "object" && value !== null && "kind" in value && "params" in value;
}

/** A button on a notice, e.g. to undo what it reports. */
export type NoticeAction = { label: string; run: () => void };

export type Notice =
  /** `action` is the way out, when the failed step knows one. */
  | { type: "error"; error: AppError; action?: NoticeAction }
  /** Already-translated text. */
  | { type: "info"; message: string; action?: NoticeAction };

/** One-at-a-time notice for actions that have no form to show it in. */
export const useNotify = create<{
  notice: Notice | null;
  // One argument, so it can be handed to `onError` as it is.
  showError: (error: unknown) => void;
  showErrorWithAction: (error: unknown, action: NoticeAction) => void;
  showInfo: (message: string, action?: NoticeAction) => void;
  dismiss: () => void;
}>((set) => ({
  notice: null,
  showError: (error) =>
    set({ notice: { type: "error", error: isAppError(error) ? error : toAppError(error) } }),
  showErrorWithAction: (error, action) =>
    set({
      notice: { type: "error", error: isAppError(error) ? error : toAppError(error), action },
    }),
  showInfo: (message, action) => set({ notice: { type: "info", message, action } }),
  dismiss: () => set({ notice: null }),
}));

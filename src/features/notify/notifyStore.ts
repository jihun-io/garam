import { create } from "zustand";

import { toAppError, type AppError } from "../../ipc";

function isAppError(value: unknown): value is AppError {
  return typeof value === "object" && value !== null && "kind" in value && "params" in value;
}

/** One-at-a-time error notice for actions that have no form to show it in. */
export const useNotify = create<{
  error: AppError | null;
  showError: (error: unknown) => void;
  dismiss: () => void;
}>((set) => ({
  error: null,
  showError: (error) => set({ error: isAppError(error) ? error : toAppError(error) }),
  dismiss: () => set({ error: null }),
}));

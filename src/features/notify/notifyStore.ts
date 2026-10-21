import { create } from "zustand";

import { toAppError, type AppError } from "../../ipc";

/** One-at-a-time error notice for actions that have no form to show it in. */
export const useNotify = create<{
  error: AppError | null;
  showError: (error: unknown) => void;
  dismiss: () => void;
}>((set) => ({
  error: null,
  showError: (error) => set({ error: toAppError(error) }),
  dismiss: () => set({ error: null }),
}));

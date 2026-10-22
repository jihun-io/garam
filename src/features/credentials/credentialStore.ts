import { create } from "zustand";

import { commands, type CredentialRequest } from "../../ipc";

/**
 * Credential prompts from running git commands, oldest first. Each one
 * blocks its git process until answered.
 */
export const useCredentials = create<{
  queue: CredentialRequest[];
  add: (request: CredentialRequest) => void;
  /** Sends the answer; `null` declines and cancels the operation. */
  respond: (requestId: string, answer: string | null) => void;
}>((set) => ({
  queue: [],
  add: (request) => set((s) => ({ queue: [...s.queue, request] })),
  respond: (requestId, answer) => {
    set((s) => ({ queue: s.queue.filter((r) => r.requestId !== requestId) }));
    void commands.credentialRespond(requestId, answer).catch(() => {});
  },
}));

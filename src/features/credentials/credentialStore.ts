import { create } from "zustand";

import { commands, type CredentialRequest } from "../../ipc";

/**
 * A prompt waiting for an answer. `retry` is set when the same operation
 * asked exactly this before: ssh asks for a passphrase up to three times
 * with the same words, so a repeat means the last answer was wrong.
 */
export type PendingCredential = CredentialRequest & { retry: boolean };

/**
 * Credential prompts from running git commands, oldest first. Each one
 * blocks its git process until answered.
 */
export const useCredentials = create<{
  queue: PendingCredential[];
  add: (request: PendingCredential) => void;
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

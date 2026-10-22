import { Channel } from "@tauri-apps/api/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { commands, unwrap, type SignInCode } from "../../ipc";

export const accountKeys = {
  all: ["accounts"] as const,
};

export function useAccounts() {
  return useQuery({
    queryKey: accountKeys.all,
    queryFn: () => commands.githubAccounts(),
  });
}

/**
 * Signs in with the device flow. `onCode` gets the code to enter on
 * GitHub; the promise settles once the user approves, declines, or the
 * sign-in is cancelled with `operationCancel(operationId)`.
 */
export function useSignIn() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      operationId,
      onCode,
    }: {
      operationId: string;
      onCode: (code: SignInCode) => void;
    }) => {
      const channel = new Channel<SignInCode>();
      channel.onmessage = onCode;
      return unwrap(commands.githubSignIn(operationId, channel));
    },
    onSettled: () => client.invalidateQueries({ queryKey: accountKeys.all }),
  });
}

export function useSignOut() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (key: string) => unwrap(commands.githubSignOut(key)),
    onSettled: () => client.invalidateQueries({ queryKey: accountKeys.all }),
  });
}

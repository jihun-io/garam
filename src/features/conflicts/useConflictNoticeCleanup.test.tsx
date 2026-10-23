import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { commands, type ConflictState } from "../../ipc";
import { useNotify } from "../notify/notifyStore";
import { conflictKeys } from "./api";
import { useConflictNoticeCleanup } from "./useConflictNoticeCleanup";

vi.mock("../../ipc/bindings", () => ({ commands: { conflictState: vi.fn() } }));

const clean: ConflictState = { operation: null, files: [], empty: false };
const merging: ConflictState = {
  operation: "merge",
  files: [{ path: "app.txt", kind: "both_modified", hasMarkers: true }],
  empty: false,
} as ConflictState;

describe("useConflictNoticeCleanup", () => {
  it("closes the conflict error once the conflicts it reported are resolved", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    vi.mocked(commands.conflictState).mockResolvedValue({ status: "ok", data: clean });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    renderHook(() => useConflictNoticeCleanup("/repo"), { wrapper });
    await vi.waitFor(() => expect(client.getQueryData(conflictKeys.state("/repo"))).toEqual(clean));

    // The error comes while the state still reads clean: it must stay.
    act(() => useNotify.getState().showError({ kind: "merge_conflict", params: {}, detail: null }));
    expect(useNotify.getState().notice).not.toBeNull();

    // The watcher refreshes the state as the merge stops, then as the
    // user finishes it.
    const refresh = async (next: ConflictState) => {
      vi.mocked(commands.conflictState).mockResolvedValue({ status: "ok", data: next });
      await act(async () => {
        await client.invalidateQueries({ queryKey: conflictKeys.state("/repo") });
        // React Query tells its observers on a timer; in the app the two
        // refreshes are seconds apart.
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
    };
    await refresh(merging);
    expect(useNotify.getState().notice).not.toBeNull();

    await refresh(clean);
    await vi.waitFor(() => expect(useNotify.getState().notice).toBeNull());
  });
});

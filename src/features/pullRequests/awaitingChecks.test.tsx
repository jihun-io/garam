import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { commands } from "../../ipc";
import { useCreatePullRequest } from "./api";
import { AWAIT_CHECKS_MS, awaitingChecks, useAwaitingChecks } from "./awaitingChecks";
import { pullRequestKeys } from "./keys";

vi.mock("../../ipc/bindings", () => ({
  commands: { pullRequestCreate: vi.fn(), pullRequestList: vi.fn() },
}));

describe("awaiting checks", () => {
  it("expects checks for a while after a push or a new pull request", () => {
    useAwaitingChecks.setState({ since: {} });
    expect(awaitingChecks("/repo")).toBe(false);
    useAwaitingChecks.getState().expect("/repo");
    const now = Date.now();
    expect(awaitingChecks("/repo", now + AWAIT_CHECKS_MS - 1000)).toBe(true);
    expect(awaitingChecks("/repo", now + AWAIT_CHECKS_MS + 1000)).toBe(false);
    expect(awaitingChecks("/other", now)).toBe(false);
  });

  it("finishes creating a pull request without waiting for GitHub to list it", async () => {
    const client = new QueryClient();
    // The badges' list, which GitHub is slow to send (here: never).
    vi.mocked(commands.pullRequestList).mockReturnValue(new Promise(() => {}));
    vi.mocked(commands.pullRequestCreate).mockResolvedValue({
      status: "ok",
      data: { number: 3, url: "https://github.com/o/r/pull/3" },
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(
      () => {
        useQuery({
          queryKey: [...pullRequestKeys.list("/repo"), "access"],
          queryFn: () => commands.pullRequestList("/repo"),
        });
        return useCreatePullRequest("/repo");
      },
      { wrapper },
    );

    let created: unknown;
    await act(async () => {
      created = await result.current.mutateAsync({
        owner: "o",
        name: "r",
        pullRequest: { title: "t", body: "", head: "h", base: "main", draft: false },
      });
    });
    expect(created).toEqual({ number: 3, url: "https://github.com/o/r/pull/3" });
    expect(awaitingChecks("/repo")).toBe(true);
  });
});

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { commands } from "../../ipc";
import { StartupGate } from "./StartupGate";

vi.mock("../../ipc/bindings", () => ({
  commands: {
    gitInfo: vi.fn(),
    repoList: vi.fn().mockResolvedValue({ repositories: [], selected: null }),
  },
}));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));

function renderGate() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <StartupGate />
    </QueryClientProvider>,
  );
}

describe("StartupGate", () => {
  beforeEach(() => vi.mocked(commands.gitInfo).mockReset());

  it("shows the first-run screen when git is available", async () => {
    vi.mocked(commands.gitInfo).mockResolvedValue({
      status: "ok",
      data: { version: "2.54.0", path: "/usr/bin/git" },
    });
    renderGate();
    expect(await screen.findByText("Using Git 2.54.0")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Add your first repository" })).toBeInTheDocument();
  });

  it("shows install guidance when git is missing", async () => {
    vi.mocked(commands.gitInfo).mockResolvedValue({
      status: "error",
      error: { kind: "git_not_found", params: {}, detail: null },
    });
    renderGate();
    expect(
      await screen.findByRole("heading", { name: "Install Git to continue" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Check again" })).toBeEnabled();
  });

  it("does not suggest installing git for unrelated failures", async () => {
    vi.mocked(commands.gitInfo).mockResolvedValue({
      status: "error",
      error: { kind: "unknown", params: {}, detail: "spawn failed" },
    });
    renderGate();
    expect(
      await screen.findByRole("heading", { name: "Garam couldn't check Git" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Open Git download page" }),
    ).not.toBeInTheDocument();
  });
});

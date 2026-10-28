import { act, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { commands, type Account } from "../../ipc";
import { renderWithQuery } from "../../test/renderWithQuery";
import { AccountsSync, useAccounts } from "./api";

const listeners = new Map<string, () => void>();

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (event: string, fn: () => void) => {
    listeners.set(event, fn);
    return () => listeners.delete(event);
  }),
}));
vi.mock("../../ipc/bindings", () => ({
  commands: { githubAccounts: vi.fn() },
}));

const account = (id: number, login: string): Account => ({
  key: `github.com/${id}`,
  host: "github.com",
  login,
  name: null,
  avatarUrl: `https://avatars.githubusercontent.com/u/${id}`,
  emails: [],
  noreplyEmail: `${id}+${login}@users.noreply.github.com`,
});

function Logins() {
  const accounts = useAccounts().data?.accounts ?? [];
  return <p>{accounts.map((a) => a.login).join(",") || "none"}</p>;
}

describe("AccountsSync", () => {
  beforeEach(() => {
    listeners.clear();
    vi.mocked(commands.githubAccounts).mockResolvedValue({
      accounts: [],
      authorizationSettingsUrl: "",
    });
  });

  it("refreshes the accounts when another window signs in", async () => {
    renderWithQuery(
      <>
        <AccountsSync />
        <Logins />
      </>,
    );
    expect(await screen.findByText("none")).toBeVisible();
    await vi.waitFor(() => expect(listeners.has("accounts-changed")).toBe(true));

    vi.mocked(commands.githubAccounts).mockResolvedValue({
      accounts: [account(1, "octocat")],
      authorizationSettingsUrl: "",
    });
    act(() => listeners.get("accounts-changed")?.());
    expect(await screen.findByText("octocat")).toBeVisible();
  });
});

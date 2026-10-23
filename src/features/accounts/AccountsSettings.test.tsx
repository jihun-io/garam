import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { commands, type Account, type SignInCode } from "../../ipc";
import { axeViolations } from "../../test/axe";
import { renderWithQuery } from "../../test/renderWithQuery";
import { AccountsSettings } from "./AccountsSettings";

vi.mock("@tauri-apps/api/core", () => ({
  Channel: class {
    onmessage: (message: unknown) => void = () => {};
  },
}));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn(async () => {}) }));
vi.mock("../../ipc/bindings", () => ({
  commands: {
    githubAccounts: vi.fn(),
    githubSignIn: vi.fn(),
    githubSignOut: vi.fn(),
    loginsList: vi.fn(),
    loginForget: vi.fn(),
    operationCancel: vi.fn(async () => null),
  },
}));

const ok = <T,>(data: T) => ({ status: "ok" as const, data });
const SETTINGS_URL = "https://github.com/settings/connections/applications/test";

const account = (id: number, login: string, name: string | null): Account => ({
  key: `github.com/${id}`,
  host: "github.com",
  login,
  name,
  avatarUrl: `https://avatars.githubusercontent.com/u/${id}`,
  emails: [],
  noreplyEmail: `${id}+${login}@users.noreply.github.com`,
});

const CODE: SignInCode = {
  userCode: "WDJB-MJHT",
  verificationUri: "https://github.com/login/device",
  expiresIn: 900,
};

/** Signs in once the test calls `approve`, after sending the code. */
function pendingSignIn() {
  let approve: (account: Account) => void = () => {};
  let fail: (kind: string) => void = () => {};
  vi.mocked(commands.githubSignIn).mockImplementation((_id, channel) => {
    (channel as unknown as { onmessage: (c: SignInCode) => void }).onmessage(CODE);
    return new Promise((resolve) => {
      approve = (a) => resolve(ok(a));
      fail = (kind) =>
        resolve({ status: "error", error: { kind, params: {}, detail: null } } as never);
    });
  });
  return { approve: (a: Account) => approve(a), fail: (kind: string) => fail(kind) };
}

describe("AccountsSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(commands.githubAccounts).mockResolvedValue({
      accounts: [account(2, "cw-jihun-io", "김지훈")],
      authorizationSettingsUrl: SETTINGS_URL,
    });
    vi.mocked(commands.loginsList).mockResolvedValue([]);
  });

  it("lists logins remembered on this computer and forgets one", async () => {
    const user = userEvent.setup();
    vi.mocked(commands.loginsList).mockResolvedValue([
      { protocol: "https", host: "git.example.com", username: "kim", savedAt: 1 },
    ]);
    vi.mocked(commands.loginForget).mockResolvedValue(ok(null));
    const { container } = renderWithQuery(<AccountsSettings />);

    const list = await screen.findByRole("list", { name: "Logins remembered on this computer" });
    expect(within(list).getByText("https://git.example.com")).toBeVisible();
    expect(await axeViolations(container)).toEqual([]);
    vi.mocked(commands.loginsList).mockResolvedValue([]);
    await user.click(screen.getByRole("button", { name: "Forget kim at https://git.example.com" }));
    expect(commands.loginForget).toHaveBeenCalledWith("https", "git.example.com", "kim");
    await vi.waitFor(() =>
      expect(screen.queryByRole("list", { name: "Logins remembered on this computer" })).toBeNull(),
    );
  });

  it("hides the remembered logins when there are none", async () => {
    renderWithQuery(<AccountsSettings />);
    await screen.findByRole("list", { name: "Signed-in accounts" });
    expect(screen.queryByText("Logins remembered on this computer")).toBeNull();
  });

  it("lists accounts and signs out", async () => {
    const user = userEvent.setup();
    vi.mocked(commands.githubSignOut).mockResolvedValue(ok(null));
    const { container } = renderWithQuery(<AccountsSettings />);

    const list = await screen.findByRole("list", { name: "Signed-in accounts" });
    expect(within(list).getByText("김지훈")).toBeVisible();
    expect(within(list).getByText(/@cw-jihun-io/)).toBeVisible();
    expect(await axeViolations(container)).toEqual([]);

    await user.click(screen.getByRole("button", { name: "Sign out of @cw-jihun-io" }));
    expect(commands.githubSignOut).toHaveBeenCalledWith("github.com/2");

    await user.click(screen.getByRole("button", { name: "GitHub settings" }));
    expect(openUrl).toHaveBeenCalledWith(SETTINGS_URL);
  });

  it("shows the code, copies it, opens the browser and adds the account", async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    const signIn = pendingSignIn();
    renderWithQuery(<AccountsSettings />);

    await user.click(await screen.findByRole("button", { name: "Add GitHub account" }));
    expect(await screen.findByLabelText("One-time code")).toHaveTextContent("WDJB-MJHT");
    expect(writeText).toHaveBeenCalledWith("WDJB-MJHT");
    expect(openUrl).toHaveBeenCalledWith("https://github.com/login/device");
    expect(await screen.findByText(/Your code is copied/)).toBeVisible();

    vi.mocked(commands.githubAccounts).mockResolvedValue({
      accounts: [account(2, "cw-jihun-io", "김지훈"), account(1, "jihun-io", null)],
      authorizationSettingsUrl: SETTINGS_URL,
    });
    signIn.approve(account(1, "jihun-io", null));

    expect(await screen.findByRole("button", { name: "Sign out of @jihun-io" })).toBeVisible();
    expect(screen.queryByLabelText("One-time code")).toBeNull();
  });

  it("cancels quietly, and explains an expired code", async () => {
    const user = userEvent.setup();
    let signIn = pendingSignIn();
    renderWithQuery(<AccountsSettings />);

    await user.click(await screen.findByRole("button", { name: "Add GitHub account" }));
    await screen.findByLabelText("One-time code");
    const operationId = vi.mocked(commands.githubSignIn).mock.calls[0][0];
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(commands.operationCancel).toHaveBeenCalledWith(operationId);
    signIn.fail("cancelled");
    await screen.findByRole("button", { name: "Add GitHub account" });
    expect(screen.queryByRole("alert")).toBeNull();

    signIn = pendingSignIn();
    await user.click(screen.getByRole("button", { name: "Add GitHub account" }));
    await screen.findByLabelText("One-time code");
    signIn.fail("github_login_expired");
    expect(await screen.findByText(/The code expired before it was approved/)).toBeVisible();
  });
});

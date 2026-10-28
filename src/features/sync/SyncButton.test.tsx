import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { commands, type BranchStatus, type RemoteEvent, type RemoteInfo } from "../../ipc";
import { isCommandEnabled, runCommand } from "../../lib/commands";
import { renderWithQuery } from "../../test/renderWithQuery";
import { CredentialDialog } from "../credentials/CredentialDialog";
import { useCredentials } from "../credentials/credentialStore";
import { Notifications } from "../notify/Notifications";
import { useNotify } from "../notify/notifyStore";
import { SyncButton } from "./SyncButton";
import { useSyncStore } from "./syncStore";

const channels: { onmessage: (e: RemoteEvent) => void }[] = [];

vi.mock("@tauri-apps/api/core", () => ({
  Channel: class {
    onmessage: (e: RemoteEvent) => void = () => {};
    constructor() {
      channels.push(this);
    }
  },
}));
vi.mock("../../ipc/bindings", () => ({
  commands: {
    statusGet: vi.fn(),
    branchList: vi.fn(),
    branchMergePreview: vi.fn(),
    remoteInfo: vi.fn(),
    remoteFetch: vi.fn(),
    remotePull: vi.fn(),
    remotePush: vi.fn(),
    remotePublish: vi.fn(),
    credentialRespond: vi.fn(),
    operationCancel: vi.fn(),
  },
}));

const ok = <T,>(data: T) => ({ status: "ok" as const, data });

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

function setup(
  branch: Partial<BranchStatus> = {},
  info: Partial<RemoteInfo> = {},
  // Recently fetched, so the background fetch stays quiet.
  lastFetchedAt = Math.floor(Date.now() / 1000) - 60,
  unpushedTags: string[] = [],
) {
  vi.mocked(commands.statusGet).mockResolvedValue(
    ok({
      branch: { head: "main", oid: "abc", upstream: "origin/main", ahead: 0, behind: 0, ...branch },
      files: [],
      unpushedTags,
    }),
  );
  vi.mocked(commands.branchList).mockResolvedValue(ok([]));
  vi.mocked(commands.branchMergePreview).mockResolvedValue(
    ok({ commits: branch.behind ?? 0, conflicts: [] }),
  );
  vi.mocked(commands.remoteInfo).mockResolvedValue(
    ok({
      remotes: [{ name: "origin", url: "https://example.com/repo.git" }],
      defaultRemote: "origin",
      lastFetchedAt,
      ...info,
    }),
  );
  return renderWithQuery(
    <>
      <SyncButton repo="/repo" />
      <Notifications />
      <CredentialDialog />
    </>,
  );
}

describe("SyncButton", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    channels.length = 0;
    useSyncStore.setState({ running: {} });
    useNotify.setState({ notice: null });
    useCredentials.setState({ queue: [] });
  });

  it("stays hidden without remotes", async () => {
    setup({}, { remotes: [], defaultRemote: null });
    await vi.waitFor(() => expect(commands.remoteInfo).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: /Fetch/ })).toBeNull();
  });

  it("fetches when in sync and shows the last fetch time", async () => {
    const user = userEvent.setup();
    vi.mocked(commands.remoteFetch).mockResolvedValue(ok(null));
    setup();
    const button = await screen.findByRole("button", { name: /Fetch origin/ });
    expect(button).toHaveTextContent("Last fetched 1 minute ago");

    await user.click(button);
    expect(commands.remoteFetch).toHaveBeenCalledWith(
      expect.any(String),
      "/repo",
      "origin",
      true,
      expect.anything(),
    );
  });

  it("fetches in the background, without prompts, when the last fetch is old", async () => {
    vi.mocked(commands.remoteFetch).mockResolvedValue(ok(null));
    setup({}, {}, Math.floor(Date.now() / 1000) - 3600);
    await vi.waitFor(() =>
      expect(commands.remoteFetch).toHaveBeenCalledWith(
        expect.any(String),
        "/repo",
        "origin",
        false,
        expect.anything(),
      ),
    );
  });

  it("pushes local commits and reports progress", async () => {
    const user = userEvent.setup();
    const result = deferred<Awaited<ReturnType<typeof commands.remotePush>>>();
    vi.mocked(commands.remotePush).mockReturnValue(result.promise);
    setup({ ahead: 2 });

    const button = await screen.findByRole("button", { name: /Push origin/ });
    expect(button).toHaveTextContent("2 commits to push");
    await user.click(button);
    expect(await screen.findByText("Pushing…")).toBeVisible();

    act(() =>
      channels[0].onmessage({
        type: "progress",
        phase: "writing",
        phasePercent: 50,
        overallPercent: 65,
      }),
    );
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "65");

    await act(async () => result.resolve(ok(null)));
    expect(await screen.findByText("Pushed to origin/main.")).toBeVisible();
  });

  it("pushes tags made in the app even with no commits to push", async () => {
    const user = userEvent.setup();
    vi.mocked(commands.remotePush).mockResolvedValue(ok(null));
    setup({}, {}, undefined, ["v1.0"]);

    const button = await screen.findByRole("button", { name: /Push origin/ });
    expect(button).toHaveTextContent("1 tag to push");
    await user.click(button);
    expect(await screen.findByText("Pushed to origin/main. 1 tag went with it.")).toBeVisible();
  });

  it("pulls first when the remote has new commits", async () => {
    const user = userEvent.setup();
    vi.mocked(commands.remotePull).mockResolvedValue(ok("updated"));
    setup({ ahead: 1, behind: 3 });

    const button = await screen.findByRole("button", { name: /Pull origin/ });
    expect(button).toHaveTextContent("3 commits to pull");
    await user.click(button);
    expect(await screen.findByText("Pulled from origin/main.")).toBeVisible();
  });

  it("offers to stash local changes when they stop a pull", async () => {
    const user = userEvent.setup();
    vi.mocked(commands.remotePull)
      .mockResolvedValueOnce({
        status: "error",
        error: { kind: "pull_blocked_by_local_changes", params: {}, detail: null },
      })
      .mockResolvedValueOnce(ok("updated_with_conflicts"));
    setup({ ahead: 1, behind: 3 });

    await user.click(await screen.findByRole("button", { name: /Pull origin/ }));
    const dialog = await screen.findByRole("dialog", { name: "Can't Pull" });
    expect(vi.mocked(commands.remotePull).mock.calls[0][2]).toBe(false);
    expect(within(dialog).getByText(/Uncommitted changes are in the way/)).toBeVisible();

    await user.click(within(dialog).getByRole("button", { name: "Stash Changes and Pull" }));
    await vi.waitFor(() => expect(commands.remotePull).toHaveBeenCalledTimes(2));
    expect(vi.mocked(commands.remotePull).mock.calls[1][2]).toBe(true);
    expect(await screen.findByText(/putting your stashed changes back conflicted/)).toBeVisible();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("lists the files a blocked pull would overwrite", async () => {
    const user = userEvent.setup();
    vi.mocked(commands.remotePull).mockResolvedValueOnce({
      status: "error",
      error: {
        kind: "pull_blocked_by_local_changes",
        params: { files: "new/a.txt\0new/b.txt" },
        detail: null,
      },
    });
    setup({ behind: 1 });

    await user.click(await screen.findByRole("button", { name: /Pull origin/ }));
    const dialog = await screen.findByRole("dialog", { name: "Can't Pull" });
    expect(within(dialog).getByText("2 files would be overwritten:")).toBeVisible();
    const items = within(dialog).getAllByRole("listitem");
    expect(items.map((li) => li.textContent)).toEqual(["new/a.txt", "new/b.txt"]);
  });

  it("doesn't offer stashing again when the stashed pull is still blocked", async () => {
    const user = userEvent.setup();
    const blocked = {
      status: "error" as const,
      error: { kind: "pull_blocked_by_local_changes" as const, params: {}, detail: "error: x" },
    };
    vi.mocked(commands.remotePull).mockResolvedValueOnce(blocked).mockResolvedValueOnce(blocked);
    setup({ behind: 1 });

    await user.click(await screen.findByRole("button", { name: /Pull origin/ }));
    const dialog = await screen.findByRole("dialog", { name: "Can't Pull" });
    // Nothing touched by the upstream: no list.
    expect(within(dialog).queryByRole("list")).toBeNull();
    await user.click(within(dialog).getByRole("button", { name: "Stash Changes and Pull" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /Uncommitted changes are in the way/,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(commands.remotePull).toHaveBeenCalledTimes(2);
  });

  it("offers sync commands to the menu and shortcuts", async () => {
    vi.mocked(commands.remotePush).mockResolvedValue(ok(null));
    setup({ ahead: 2 });
    await screen.findByRole("button", { name: /Push origin/ });
    expect(isCommandEnabled("sync.fetch")).toBe(true);
    expect(isCommandEnabled("sync.pull")).toBe(true);
    act(() => void runCommand("sync.push"));
    await vi.waitFor(() => expect(commands.remotePush).toHaveBeenCalled());
    expect(await screen.findByText("Pushed to origin/main.")).toBeVisible();
  });

  it("publishes a branch without an upstream", async () => {
    const user = userEvent.setup();
    vi.mocked(commands.remotePublish).mockResolvedValue(ok(null));
    setup({ head: "feature", upstream: null });

    await user.click(await screen.findByRole("button", { name: /Publish branch/ }));
    expect(commands.remotePublish).toHaveBeenCalledWith(
      expect.any(String),
      "/repo",
      "origin",
      expect.anything(),
    );
    expect(await screen.findByText("Published feature to origin.")).toBeVisible();
  });

  it("can't publish before the first commit", async () => {
    setup({ upstream: null, oid: null });
    expect(await screen.findByRole("button", { name: /Publish branch/ })).toBeDisabled();
  });

  it("explains a rejected push", async () => {
    const user = userEvent.setup();
    vi.mocked(commands.remotePush).mockResolvedValue({
      status: "error",
      error: { kind: "non_fast_forward", params: {}, detail: "! [rejected]" },
    });
    setup({ ahead: 1 });

    await user.click(await screen.findByRole("button", { name: /Push origin/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The remote has commits you don't have yet. Pull first, then push again.",
    );

    // The way out is right there; it pulls, and leaves pushing to the user.
    vi.mocked(commands.remotePull).mockResolvedValue(ok("updated"));
    await user.click(screen.getByRole("button", { name: "Pull first" }));
    await vi.waitFor(() => expect(commands.remotePull).toHaveBeenCalled());
    expect(commands.remotePush).toHaveBeenCalledTimes(1);
  });

  it("asks before a pull that would conflict", async () => {
    const user = userEvent.setup();
    vi.mocked(commands.remotePull).mockResolvedValue(ok("updated"));
    setup({ behind: 2 });
    vi.mocked(commands.branchMergePreview).mockResolvedValue(
      ok({ commits: 2, conflicts: ["src/app.ts"] }),
    );

    const button = await screen.findByRole("button", { name: /Pull origin/ });
    await vi.waitFor(() =>
      expect(commands.branchMergePreview).toHaveBeenCalledWith("/repo", "@{upstream}"),
    );
    await user.click(button);
    const dialog = await screen.findByRole("dialog", { name: "Pulling Will Conflict" });
    expect(within(dialog).getByText("src/app.ts")).toBeVisible();
    expect(commands.remotePull).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole("button", { name: "Pull Anyway" }));
    await vi.waitFor(() => expect(commands.remotePull).toHaveBeenCalled());
  });

  it("asks for credentials and sends the answer back", async () => {
    const user = userEvent.setup();
    const result = deferred<Awaited<ReturnType<typeof commands.remotePush>>>();
    vi.mocked(commands.remotePush).mockReturnValue(result.promise);
    vi.mocked(commands.credentialRespond).mockResolvedValue();
    setup({ ahead: 1 });

    await user.click(await screen.findByRole("button", { name: /Push origin/ }));
    act(() =>
      channels[0].onmessage({
        type: "credential",
        requestId: "7",
        canRemember: false,
        prompt: {
          kind: "password",
          target: "https://me@example.com",
          fingerprint: null,
          text: "Password for 'https://me@example.com': ",
        },
      }),
    );

    expect(await screen.findByRole("dialog", { name: "Sign in" })).toBeVisible();
    expect(screen.getByText("Enter the password for https://me@example.com.")).toBeVisible();
    expect(screen.getByText(/credential helper/)).toBeVisible();
    const field = screen.getByLabelText("Password or token");
    expect(field).toHaveAttribute("type", "password");
    await user.type(field, "s3cret{enter}");
    expect(commands.credentialRespond).toHaveBeenCalledWith("7", "s3cret", false);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("tells an SSH key's passphrase apart from what a helper remembers", async () => {
    setup();
    await screen.findByRole("button", { name: /Fetch origin/ });
    act(() =>
      useCredentials.getState().add({
        requestId: "8",
        retry: false,
        canRemember: false,
        prompt: {
          kind: "ssh_passphrase",
          target: "/Users/me/.ssh/id_ed25519",
          fingerprint: null,
          text: "Enter passphrase for key '/Users/me/.ssh/id_ed25519': ",
        },
      }),
    );
    expect(await screen.findByText(/added to an SSH agent/)).toBeVisible();
    expect(screen.queryByText(/credential helper/)).toBeNull();
  });

  it("offers to remember a password where git has no credential helper", async () => {
    const user = userEvent.setup();
    vi.mocked(commands.remotePush).mockReturnValue(new Promise(() => {}));
    vi.mocked(commands.credentialRespond).mockResolvedValue();
    setup({ ahead: 1 });
    await user.click(await screen.findByRole("button", { name: /Push origin/ }));
    const ask = (requestId: string, canRemember: boolean) =>
      act(() =>
        channels[0].onmessage({
          type: "credential",
          requestId,
          canRemember,
          prompt: {
            kind: "password",
            target: "https://me@example.com",
            fingerprint: null,
            text: "Password for 'https://me@example.com': ",
          },
        }),
      );

    ask("1", true);
    const remember = await screen.findByRole("checkbox", { name: /Remember on this computer/ });
    expect(remember).toBeChecked();
    expect(screen.queryByText(/credential helper/)).toBeNull();
    await user.type(screen.getByLabelText("Password or token"), "s3cret{enter}");
    expect(commands.credentialRespond).toHaveBeenLastCalledWith("1", "s3cret", true);

    ask("2", true);
    await user.click(await screen.findByRole("checkbox", { name: /Remember on this computer/ }));
    await user.type(screen.getByLabelText("Password or token"), "s3cret{enter}");
    expect(commands.credentialRespond).toHaveBeenLastCalledWith("2", "s3cret", false);

    // A helper of the user's remembers it instead; no box then.
    ask("3", false);
    await screen.findByText(/credential helper/);
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("says the passphrase was wrong when ssh asks again", async () => {
    const user = userEvent.setup();
    vi.mocked(commands.remotePush).mockReturnValue(new Promise(() => {}));
    vi.mocked(commands.credentialRespond).mockResolvedValue();
    setup({ ahead: 1 });
    await user.click(await screen.findByRole("button", { name: /Push origin/ }));
    const ask = (requestId: string) =>
      act(() =>
        channels[0].onmessage({
          type: "credential",
          requestId,
          canRemember: false,
          prompt: {
            kind: "ssh_passphrase",
            target: "/Users/me/.ssh/id_ed25519",
            fingerprint: null,
            text: "Enter passphrase for key '/Users/me/.ssh/id_ed25519': ",
          },
        }),
      );

    ask("1");
    await screen.findByRole("dialog", { name: "Unlock SSH key" });
    expect(screen.queryByText(/is incorrect/)).toBeNull();
    await user.type(screen.getByLabelText("Passphrase"), "wrong{enter}");

    ask("2");
    expect(await screen.findByText(/is incorrect/)).toBeVisible();
  });

  it("cancelling a prompt declines it quietly", async () => {
    const user = userEvent.setup();
    vi.mocked(commands.remoteFetch).mockResolvedValue({
      status: "error",
      error: { kind: "cancelled", params: {}, detail: null },
    });
    vi.mocked(commands.credentialRespond).mockResolvedValue();
    setup();
    await screen.findByRole("button", { name: /Fetch origin/ });

    act(() =>
      useCredentials.getState().add({
        requestId: "9",
        retry: false,
        canRemember: false,
        prompt: {
          kind: "host_key",
          target: "example.com",
          fingerprint: "ED25519 SHA256:abc",
          text: "...",
        },
      }),
    );
    expect(await screen.findByText("ED25519 SHA256:abc")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(commands.credentialRespond).toHaveBeenCalledWith("9", null, false);

    await user.click(screen.getByRole("button", { name: /Fetch origin/ }));
    await vi.waitFor(() => expect(commands.remoteFetch).toHaveBeenCalled());
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("trusting a host key answers yes", async () => {
    const user = userEvent.setup();
    vi.mocked(commands.credentialRespond).mockResolvedValue();
    setup();
    await screen.findByRole("button", { name: /Fetch origin/ });
    act(() =>
      useCredentials.getState().add({
        requestId: "3",
        retry: false,
        canRemember: false,
        prompt: { kind: "host_key", target: "example.com", fingerprint: null, text: "..." },
      }),
    );
    await user.click(await screen.findByRole("button", { name: "Trust and connect" }));
    expect(commands.credentialRespond).toHaveBeenCalledWith("3", "yes", false);
  });
});

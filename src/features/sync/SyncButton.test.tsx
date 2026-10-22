import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { commands, type BranchStatus, type RemoteEvent, type RemoteInfo } from "../../ipc";
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
) {
  vi.mocked(commands.statusGet).mockResolvedValue(
    ok({
      branch: { head: "main", oid: "abc", upstream: "origin/main", ahead: 0, behind: 0, ...branch },
      files: [],
    }),
  );
  vi.mocked(commands.branchList).mockResolvedValue(ok([]));
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

  it("pulls first when the remote has new commits", async () => {
    const user = userEvent.setup();
    vi.mocked(commands.remotePull).mockResolvedValue(ok("updated"));
    setup({ ahead: 1, behind: 3 });

    const button = await screen.findByRole("button", { name: /Pull origin/ });
    expect(button).toHaveTextContent("3 commits to pull");
    await user.click(button);
    expect(await screen.findByText("Pulled from origin/main.")).toBeVisible();
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
    const field = screen.getByLabelText("Password or token");
    expect(field).toHaveAttribute("type", "password");
    await user.type(field, "s3cret{enter}");
    expect(commands.credentialRespond).toHaveBeenCalledWith("7", "s3cret");
    expect(screen.queryByRole("dialog")).toBeNull();
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
    expect(commands.credentialRespond).toHaveBeenCalledWith("9", null);

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
        prompt: { kind: "host_key", target: "example.com", fingerprint: null, text: "..." },
      }),
    );
    await user.click(await screen.findByRole("button", { name: "Trust and connect" }));
    expect(commands.credentialRespond).toHaveBeenCalledWith("3", "yes");
  });
});

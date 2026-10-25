import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { commands, type Account, type RemoteEvent } from "../../../ipc";
import { renderWithQuery } from "../../../test/renderWithQuery";
import { CloneRepositoryDialog } from "./CloneRepositoryDialog";

const channels: { onmessage: (e: RemoteEvent) => void }[] = [];

vi.mock("@tauri-apps/api/core", () => ({
  Channel: class {
    onmessage: (e: RemoteEvent) => void = () => {};
    constructor() {
      channels.push(this);
    }
  },
}));
vi.mock("@tauri-apps/api/path", () => ({ documentDir: async () => "/Users/me/Documents" }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("../../../ipc/bindings", () => ({
  commands: {
    repoClone: vi.fn(),
    operationCancel: vi.fn(),
    githubAccounts: vi.fn(),
    identityGet: vi.fn(),
    identitySetLocal: vi.fn(),
  },
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe("CloneRepositoryDialog", () => {
  beforeEach(() => {
    channels.length = 0;
    vi.mocked(commands.repoClone).mockReset();
    vi.mocked(commands.githubAccounts).mockResolvedValue({
      accounts: [],
      authorizationSettingsUrl: "",
    });
    localStorage.clear();
  });

  it("derives the folder name from the URL and shows progress", async () => {
    const user = userEvent.setup();
    const result = deferred<Awaited<ReturnType<typeof commands.repoClone>>>();
    vi.mocked(commands.repoClone).mockReturnValue(result.promise);
    const onClose = vi.fn();
    renderWithQuery(<CloneRepositoryDialog onClose={onClose} />);

    await user.type(screen.getByLabelText("Repository URL"), "https://github.com/owner/garam.git");
    expect(screen.getByLabelText("Folder name")).toHaveValue("garam");
    expect(await screen.findByText("Will be created at /Users/me/Documents/garam")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Clone" }));
    expect(commands.repoClone).toHaveBeenCalledWith(
      expect.any(String),
      "https://github.com/owner/garam.git",
      "/Users/me/Documents",
      "garam",
      null,
      expect.anything(),
    );
    expect(screen.getByText("Connecting…")).toBeVisible();

    act(() =>
      channels[0].onmessage({
        type: "progress",
        phase: "receiving",
        phasePercent: 50,
        overallPercent: 43,
      }),
    );
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "43");
    expect(screen.getByText("Receiving objects")).toBeVisible();

    await act(async () =>
      result.resolve({
        status: "ok",
        data: {
          path: "/Users/me/Documents/garam",
          name: "garam",
          addedAt: 0,
          lastOpenedAt: 0,
          account: null,
          editor: null,
          missing: false,
        },
      }),
    );
    expect(onClose).toHaveBeenCalled();
    expect(localStorage.getItem("garam.lastParentDir")).toBe("/Users/me/Documents");
  });

  it("returns to the form quietly when cancelled", async () => {
    const user = userEvent.setup();
    const result = deferred<Awaited<ReturnType<typeof commands.repoClone>>>();
    vi.mocked(commands.repoClone).mockReturnValue(result.promise);
    renderWithQuery(<CloneRepositoryDialog onClose={vi.fn()} />);

    await user.type(screen.getByLabelText("Repository URL"), "git@host:a/b.git");
    await user.click(screen.getByRole("button", { name: "Clone" }));
    await user.click(screen.getByRole("button", { name: "Cancel clone" }));
    const operationId = vi.mocked(commands.repoClone).mock.calls[0][0];
    expect(commands.operationCancel).toHaveBeenCalledWith(operationId);

    await act(async () =>
      result.resolve({
        status: "error",
        error: { kind: "cancelled", params: {}, detail: null },
      }),
    );
    expect(screen.getByLabelText("Repository URL")).toHaveValue("git@host:a/b.git");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("keeps a name the user typed even when the URL changes", async () => {
    const user = userEvent.setup();
    renderWithQuery(<CloneRepositoryDialog onClose={vi.fn()} />);
    const url = screen.getByLabelText("Repository URL");
    const name = screen.getByLabelText("Folder name");

    await user.type(url, "https://x.test/a/first.git");
    await user.clear(name);
    await user.type(name, "내 폴더");
    await user.clear(url);
    await user.type(url, "https://x.test/a/second.git");
    expect(name).toHaveValue("내 폴더");
  });

  it("suggests the account that owns the repository and clones with it", async () => {
    const user = userEvent.setup();
    vi.mocked(commands.githubAccounts).mockResolvedValue({
      accounts: [account(1, "jihun-io"), account(2, "cw-team")],
      authorizationSettingsUrl: "",
    });
    vi.mocked(commands.repoClone).mockReturnValue(new Promise(() => {}));
    renderWithQuery(<CloneRepositoryDialog onClose={vi.fn()} />);

    const picker = await screen.findByRole("combobox", { name: "GitHub account" });
    expect(picker).toHaveTextContent("None (use my Git settings)");
    await user.type(screen.getByLabelText("Repository URL"), "https://github.com/cw-team/app.git");
    expect(picker).toHaveTextContent("@cw-team — suggested");
    expect(screen.getByText(/signs in as @cw-team over HTTPS/)).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Clone" }));
    expect(vi.mocked(commands.repoClone).mock.calls[0][4]).toBe("github.com/2");
  });

  it("clones without an account when the user picks none", async () => {
    const user = userEvent.setup();
    vi.mocked(commands.githubAccounts).mockResolvedValue({
      accounts: [account(1, "jihun-io")],
      authorizationSettingsUrl: "",
    });
    vi.mocked(commands.repoClone).mockReturnValue(new Promise(() => {}));
    renderWithQuery(<CloneRepositoryDialog onClose={vi.fn()} />);

    await user.type(screen.getByLabelText("Repository URL"), "https://github.com/jihun-io/a.git");
    await user.click(await screen.findByRole("combobox", { name: "GitHub account" }));
    await user.click(await screen.findByRole("option", { name: "None (use my Git settings)" }));
    await user.click(screen.getByRole("button", { name: "Clone" }));
    expect(vi.mocked(commands.repoClone).mock.calls[0][4]).toBeNull();
  });

  describe("after cloning with an account", () => {
    const work = { ...account(2, "cw-team"), emails: ["jh@cw.example"] };
    const entry = {
      path: "/Users/me/Documents/app",
      name: "app",
      addedAt: 0,
      lastOpenedAt: 0,
      account: work.key,
      editor: null,
      missing: false,
    };
    const identity = (email: string) => ({
      status: "ok" as const,
      data: {
        effective: { name: "김지훈", email },
        local: { name: null, email: null },
        inherited: { name: "김지훈", email },
      },
    });

    beforeEach(() => {
      vi.mocked(commands.githubAccounts).mockResolvedValue({
        accounts: [work],
        authorizationSettingsUrl: "",
      });
      vi.mocked(commands.repoClone).mockResolvedValue({ status: "ok", data: entry });
      vi.mocked(commands.identitySetLocal).mockReset();
      vi.mocked(commands.identitySetLocal).mockResolvedValue({ status: "ok", data: null });
    });

    async function cloneWorkRepo() {
      const user = userEvent.setup();
      const onClose = vi.fn();
      renderWithQuery(<CloneRepositoryDialog onClose={onClose} />);
      await user.type(screen.getByLabelText("Repository URL"), "https://github.com/cw-team/app");
      expect(await screen.findByRole("combobox", { name: "GitHub account" })).toHaveTextContent(
        "@cw-team",
      );
      await user.click(screen.getByRole("button", { name: "Clone" }));
      return { user, onClose };
    }

    it("asks which author to use when the account doesn't have the email", async () => {
      vi.mocked(commands.identityGet).mockResolvedValue(identity("kim@jihun.io"));
      const { user, onClose } = await cloneWorkRepo();

      expect(await screen.findByRole("dialog", { name: "Choose the commit author" })).toBeVisible();
      expect(screen.getByText(/by kim@jihun.io, which isn't on @cw-team/)).toBeVisible();
      expect(screen.getByRole("radio", { name: "jh@cw.example" })).toBeChecked();
      expect(screen.getByRole("radio", { name: /Keep kim@jihun.io/ })).toBeVisible();
      expect(onClose).not.toHaveBeenCalled();

      await user.click(screen.getByRole("radio", { name: /2\+cw-team@users.noreply/ }));
      await user.click(screen.getByRole("button", { name: "Continue" }));
      expect(commands.identitySetLocal).toHaveBeenCalledWith(
        entry.path,
        "김지훈",
        "2+cw-team@users.noreply.github.com",
      );
      expect(onClose).toHaveBeenCalled();
    });

    it("leaves the author alone when the user keeps it", async () => {
      vi.mocked(commands.identityGet).mockResolvedValue(identity("kim@jihun.io"));
      const { user, onClose } = await cloneWorkRepo();

      await user.click(await screen.findByRole("radio", { name: /Keep kim@jihun.io/ }));
      await user.click(screen.getByRole("button", { name: "Continue" }));
      expect(commands.identitySetLocal).not.toHaveBeenCalled();
      expect(onClose).toHaveBeenCalled();
    });

    it("doesn't ask when Git already uses one of the account's emails", async () => {
      vi.mocked(commands.identityGet).mockResolvedValue(identity("JH@cw.example"));
      const { onClose } = await cloneWorkRepo();

      await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
      expect(
        screen.queryByRole("dialog", { name: "Choose the commit author" }),
      ).not.toBeInTheDocument();
    });
  });

  it("shows translated errors", async () => {
    const user = userEvent.setup();
    vi.mocked(commands.repoClone).mockResolvedValue({
      status: "error",
      error: {
        kind: "authentication_failed",
        params: {},
        detail: "fatal: could not read Username",
      },
    });
    renderWithQuery(<CloneRepositoryDialog onClose={vi.fn()} />);
    await user.type(screen.getByLabelText("Repository URL"), "https://x.test/private.git");
    await user.click(screen.getByRole("button", { name: "Clone" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Git couldn't sign in to the remote.",
    );
  });
});

function account(id: number, login: string): Account {
  return {
    key: `github.com/${id}`,
    host: "github.com",
    login,
    name: null,
    avatarUrl: "",
    emails: [],
    noreplyEmail: `${id}+${login}@users.noreply.github.com`,
  };
}

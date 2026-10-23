import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { commands, type RemoteEvent } from "../../../ipc";
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
  commands: { repoClone: vi.fn(), operationCancel: vi.fn() },
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

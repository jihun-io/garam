import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { commands, type BaseStatus } from "../../ipc";
import { axeViolations } from "../../test/axe";
import { renderWithQuery } from "../../test/renderWithQuery";
import { Notifications } from "../notify/Notifications";
import { useNotify } from "../notify/notifyStore";
import { BaseBanner } from "./BaseBanner";
import { useBaseNotices } from "./baseNotice";

vi.mock("@tauri-apps/api/core", () => ({
  Channel: class {
    onmessage = () => {};
  },
}));
vi.mock("../../ipc/bindings", () => ({
  commands: {
    statusGet: vi.fn(),
    remoteInfo: vi.fn(),
    remoteFetch: vi.fn(),
    branchBaseStatus: vi.fn(),
    branchUpdateFrom: vi.fn(),
  },
}));

const ok = <T,>(data: T) => ({ status: "ok" as const, data });

function setup(base: Partial<BaseStatus>, files: { path: string }[] = []) {
  vi.mocked(commands.branchBaseStatus).mockResolvedValue(
    ok({
      base: "origin/main",
      baseBranch: "main",
      behind: 3,
      conflicts: ["src/app.ts"],
      published: true,
      ...base,
    }),
  );
  vi.mocked(commands.statusGet).mockResolvedValue(
    ok({
      branch: { head: "feature", oid: "abc", upstream: null, ahead: 1, behind: 0 },
      files: files.map((f) => ({
        ...f,
        origPath: null,
        staged: null,
        unstaged: "modified" as const,
        isSubmodule: false,
      })),
      unpushedTags: [],
    }),
  );
  vi.mocked(commands.remoteInfo).mockResolvedValue(
    ok({ remotes: [{ name: "origin", url: "" }], defaultRemote: "origin", lastFetchedAt: 0 }),
  );
  vi.mocked(commands.remoteFetch).mockResolvedValue(ok(null));
  return renderWithQuery(
    <>
      <BaseBanner repo="/repo" branch="feature" />
      <Notifications />
    </>,
  );
}

describe("BaseBanner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useBaseNotices.setState({ dismissed: {} });
    useNotify.setState({ notice: null });
  });

  it("warns when bringing main in would conflict, and stays quiet after Later", async () => {
    const user = userEvent.setup();
    setup({});
    const banner = await screen.findByRole("status");
    expect(banner).toHaveTextContent("main has 3 new commits");
    expect(banner).toHaveTextContent("Bringing it in now conflicts in 1 file.");
    expect(await axeViolations(banner)).toEqual([]);

    await user.click(within(banner).getByRole("button", { name: "Later" }));
    expect(screen.queryByText("main has 3 new commits")).toBeNull();
  });

  it("says nothing for a few commits that merge cleanly", async () => {
    setup({ behind: 3, conflicts: [] });
    await vi.waitFor(() => expect(commands.branchBaseStatus).toHaveBeenCalled());
    expect(screen.queryByText(/new commits/)).toBeNull();
  });

  it("merges main into a pushed branch, which can't be rebased", async () => {
    const user = userEvent.setup();
    vi.mocked(commands.branchUpdateFrom).mockResolvedValue(ok("merged"));
    setup({}, [{ path: "draft.txt" }]);
    await user.click(await screen.findByRole("button", { name: "Bring In main…" }));

    const dialog = await screen.findByRole("dialog", { name: "Bring In main" });
    // It fetches quietly first, so the preview is current.
    await vi.waitFor(() =>
      expect(commands.remoteFetch).toHaveBeenCalledWith(
        expect.any(String),
        "/repo",
        "origin",
        false,
        expect.anything(),
      ),
    );
    expect(within(dialog).getByRole("radio", { name: "Rebase" })).toBeDisabled();
    expect(within(dialog).getByText(/A branch already pushed/)).toBeVisible();
    expect(within(dialog).getByText(/Uncommitted changes are set aside/)).toBeVisible();

    await user.click(within(dialog).getByRole("button", { name: "Merge and Resolve Conflicts" }));
    expect(commands.branchUpdateFrom).toHaveBeenCalledWith("/repo", "origin/main", "merge");
    expect(await screen.findByText("Merged origin/main into feature.")).toBeVisible();
  });

  it("rebases a branch that isn't on the remote yet", async () => {
    const user = userEvent.setup();
    vi.mocked(commands.branchUpdateFrom).mockResolvedValue(ok("rebased"));
    setup({ behind: 12, conflicts: [], published: false });
    await user.click(await screen.findByRole("button", { name: "Bring In main…" }));

    const dialog = await screen.findByRole("dialog", { name: "Bring In main" });
    await user.click(within(dialog).getByRole("radio", { name: "Rebase" }));
    await user.click(within(dialog).getByRole("button", { name: "Rebase" }));
    expect(commands.branchUpdateFrom).toHaveBeenCalledWith("/repo", "origin/main", "rebase");
  });

  it("hands a conflicting merge over to conflict resolution", async () => {
    const user = userEvent.setup();
    vi.mocked(commands.branchUpdateFrom).mockResolvedValue({
      status: "error",
      error: { kind: "merge_conflict", params: {}, detail: null },
    });
    setup({});
    await user.click(await screen.findByRole("button", { name: "Bring In main…" }));
    const dialog = await screen.findByRole("dialog", { name: "Bring In main" });
    await user.click(within(dialog).getByRole("button", { name: "Merge and Resolve Conflicts" }));

    expect(await screen.findByRole("button", { name: "Resolve conflicts" })).toBeVisible();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

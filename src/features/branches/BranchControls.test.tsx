import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { commands, type Branch, type FileChange } from "../../ipc";
import { renderWithQuery } from "../../test/renderWithQuery";
import { Notifications } from "../notify/Notifications";
import { useNotify } from "../notify/notifyStore";
import { useBranchDialog } from "./branchDialogStore";
import { AutoStashBanner } from "./AutoStashBanner";
import { BranchControls } from "./BranchControls";

vi.mock("../../ipc/bindings", () => ({
  commands: {
    statusGet: vi.fn(),
    branchList: vi.fn(),
    branchCreate: vi.fn(),
    branchSwitch: vi.fn(),
    branchRename: vi.fn(),
    branchDelete: vi.fn(),
    branchMergePreview: vi.fn(),
    branchMerge: vi.fn(),
    stashFindAuto: vi.fn(),
    stashPop: vi.fn(),
    stashDrop: vi.fn(),
  },
}));

const ok = <T,>(data: T) => ({ status: "ok" as const, data });

const branch = (name: string, extra: Partial<Branch> = {}): Branch => ({
  name,
  kind: "local",
  remote: null,
  oid: "abc",
  isHead: false,
  upstream: null,
  upstreamGone: false,
  ahead: 0,
  behind: 0,
  committedAt: Math.floor(Date.now() / 1000) - 3600,
  subject: "work",
  ...extra,
});

const branches = [
  branch("main", { isHead: true, upstream: "origin/main", ahead: 2 }),
  branch("feature"),
  branch("origin/main", { kind: "remote", remote: "origin" }),
  branch("origin/review", { kind: "remote", remote: "origin" }),
];

function setup(files: FileChange[] = []) {
  vi.mocked(commands.statusGet).mockResolvedValue(
    ok({ branch: { head: "main", oid: "abc", upstream: null, ahead: 0, behind: 0 }, files }),
  );
  vi.mocked(commands.branchList).mockResolvedValue(ok(branches));
  for (const fn of [
    commands.branchCreate,
    commands.branchSwitch,
    commands.branchRename,
    commands.stashPop,
    commands.stashDrop,
  ]) {
    vi.mocked(fn).mockResolvedValue(ok(null));
  }
  return renderWithQuery(
    <>
      <BranchControls repo="/repo" />
      <Notifications />
    </>,
  );
}

async function openPicker(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: "Current branch: main" }));
}

describe("BranchControls", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useBranchDialog.setState({ dialog: null });
    useNotify.setState({ notice: null });
  });

  it("lists local branches and only remote branches without a local copy", async () => {
    const user = userEvent.setup();
    setup();
    await openPicker(user);
    const local = screen.getByRole("region", { name: "Branches" });
    expect(
      within(local)
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual([expect.stringContaining("main"), expect.stringContaining("feature")]);
    expect(within(local).getByTitle("2 to push")).toBeVisible();
    const remote = screen.getByRole("region", { name: "Remote branches" });
    expect(within(remote).getByText("origin/review")).toBeVisible();
    expect(within(remote).queryByText("origin/main")).not.toBeInTheDocument();
  });

  it("switches straight away when there are no changes", async () => {
    const user = userEvent.setup();
    setup();
    await openPicker(user);
    await user.click(screen.getByText("feature"));
    expect(commands.branchSwitch).toHaveBeenCalledWith(
      "/repo",
      expect.objectContaining({ name: "feature" }),
      "bring_changes",
      "main",
    );
  });

  it("asks what to do with uncommitted changes", async () => {
    const user = userEvent.setup();
    setup([
      { path: "a.txt", origPath: null, staged: null, unstaged: "modified", isSubmodule: false },
    ]);
    await openPicker(user);
    await user.click(screen.getByText("feature"));

    const dialog = await screen.findByRole("dialog", { name: "Switch to feature?" });
    expect(within(dialog).getByLabelText(/Leave my changes on main/)).toBeChecked();
    await user.click(within(dialog).getByRole("button", { name: "Switch branch" }));
    expect(commands.branchSwitch).toHaveBeenCalledWith(
      "/repo",
      expect.objectContaining({ name: "feature" }),
      "leave_changes",
      "main",
    );
  });

  it("creates a branch from a friendly name", async () => {
    const user = userEvent.setup();
    setup();
    await openPicker(user);
    await user.click(screen.getByRole("button", { name: "New branch…" }));
    const dialog = await screen.findByRole("dialog", { name: "Create a branch" });
    await user.type(within(dialog).getByLabelText("Name"), "로그인 화면 개선");
    expect(within(dialog).getByText("Will be created as 로그인-화면-개선")).toBeVisible();
    await user.click(within(dialog).getByRole("button", { name: "Create branch" }));
    expect(commands.branchCreate).toHaveBeenCalledWith("/repo", "로그인-화면-개선");
  });

  it("asks again before force-deleting an unmerged branch", async () => {
    const user = userEvent.setup();
    setup();
    vi.mocked(commands.branchDelete)
      .mockResolvedValueOnce({
        status: "error",
        error: { kind: "branch_not_merged", params: {}, detail: null },
      })
      .mockResolvedValueOnce(ok(null));
    useBranchDialog.setState({ dialog: { kind: "delete", branch: branches[1] } });

    const dialog = await screen.findByRole("dialog", { name: "Delete feature?" });
    await user.click(within(dialog).getByRole("button", { name: "Delete branch" }));
    expect(commands.branchDelete).toHaveBeenLastCalledWith("/repo", "feature", false);

    const again = await screen.findByRole("dialog", { name: "feature has unmerged commits" });
    await user.click(within(again).getByRole("button", { name: "Delete anyway" }));
    expect(commands.branchDelete).toHaveBeenLastCalledWith("/repo", "feature", true);
  });

  it("previews a merge and reports the result", async () => {
    const user = userEvent.setup();
    setup();
    vi.mocked(commands.branchMergePreview).mockResolvedValue(ok(3));
    vi.mocked(commands.branchMerge).mockResolvedValue(ok("merged"));
    await openPicker(user);
    await user.click(screen.getByRole("button", { name: "Merge into main…" }));

    const dialog = await screen.findByRole("dialog", { name: "Merge into main" });
    await user.click(within(dialog).getByRole("option", { name: "feature" }));
    expect(
      await within(dialog).findByText("This will bring 3 commits from feature into main."),
    ).toBeVisible();
    await user.click(within(dialog).getByRole("button", { name: "Merge feature into main" }));

    expect(commands.branchMerge).toHaveBeenCalledWith("/repo", "feature");
    expect(await screen.findByRole("status")).toHaveTextContent("Merged feature into main.");
  });
});

describe("AutoStashBanner", () => {
  it("restores changes left on the branch", async () => {
    const user = userEvent.setup();
    vi.mocked(commands.stashFindAuto).mockResolvedValue(ok({ oid: "s1", branch: "main" }));
    vi.mocked(commands.stashPop).mockResolvedValue(ok(null));
    renderWithQuery(<AutoStashBanner repo="/repo" branch="main" />);
    await user.click(await screen.findByRole("button", { name: "Restore changes" }));
    expect(commands.stashPop).toHaveBeenCalledWith("/repo", "s1");
  });

  it("stays hidden when nothing was left behind", async () => {
    vi.mocked(commands.stashFindAuto).mockResolvedValue(ok(null));
    renderWithQuery(<AutoStashBanner repo="/repo" branch="main" />);
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByRole("button", { name: "Restore changes" })).not.toBeInTheDocument();
  });
});

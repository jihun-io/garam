import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { commands, type Branch, type FileChange } from "../../ipc";
import { renderWithQuery } from "../../test/renderWithQuery";
import { Notifications } from "../notify/Notifications";
import { useNotify } from "../notify/notifyStore";
import { useCommitDrag } from "../history/commitDragStore";
import { useHistoryPane } from "../history/historyPaneStore";
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
    branchUpdateFrom: vi.fn(),
    stashFindAuto: vi.fn(),
    stashApply: vi.fn(),
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
    ok({
      branch: { head: "main", oid: "abc", upstream: null, ahead: 0, behind: 0 },
      files,
      unpushedTags: [],
    }),
  );
  vi.mocked(commands.branchList).mockResolvedValue(ok(branches));
  for (const fn of [
    commands.branchCreate,
    commands.branchSwitch,
    commands.branchRename,
    commands.stashDrop,
  ]) {
    vi.mocked(fn).mockResolvedValue(ok(null));
  }
  vi.mocked(commands.stashApply).mockResolvedValue(ok("applied"));
  return renderWithQuery(
    <>
      <BranchControls repo="/repo" />
      <Notifications />
    </>,
  );
}

async function openPicker(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: "Current branch main" }));
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
    expect(within(local).getByText("2 commits to push")).toBeVisible();
    const remote = screen.getByRole("region", { name: "Remote branches" });
    expect(within(remote).getByText("origin/review")).toBeVisible();
    expect(within(remote).queryByText("origin/main")).not.toBeInTheDocument();
  });

  it("compares a branch, remote ones too, with the current one", async () => {
    const user = userEvent.setup();
    useHistoryPane.setState({ panes: {} });
    setup();
    await openPicker(user);
    await user.pointer({ keys: "[MouseRight]", target: screen.getByText("origin/review") });
    const menu = await screen.findByRole("menu");
    // Remote branches can't be renamed or deleted from here.
    expect(within(menu).queryByRole("menuitem", { name: "Rename…" })).toBeNull();
    await user.click(
      within(menu).getByRole("menuitem", { name: "Compare with Current Branch (main)" }),
    );
    expect(useHistoryPane.getState().panes["/repo"]).toEqual({
      kind: "compare",
      base: "refs/heads/main",
      target: "refs/remotes/origin/review",
      mode: "three_dot",
      baseLabel: "main",
      targetLabel: "origin/review",
    });

    await openPicker(user);
    await user.pointer({ keys: "[MouseRight]", target: screen.getAllByText("main")[1] });
    const own = await screen.findByRole("menu");
    expect(within(own).queryByRole("menuitem", { name: /Compare with/ })).toBeNull();
    // Without the compare item there is nothing to separate from.
    expect(own.firstElementChild).toHaveRole("menuitem");
  });

  it("opens for dragged commits and takes them on local branches", async () => {
    setup();
    const button = await screen.findByRole("button", { name: "Current branch main" });
    expect(button).toHaveAttribute("data-drop-branch", "main");
    act(() =>
      useCommitDrag
        .getState()
        .set({ commits: [], x: 0, y: 0, over: null, insertAt: null, squashOnto: null }),
    );
    fireEvent.mouseEnter(button);
    const local = await screen.findByRole("region", { name: "Branches" });
    expect(within(local).getByText("feature").closest("button")).toHaveAttribute(
      "data-drop-branch",
      "feature",
    );
    const remote = screen.getByRole("region", { name: "Remote branches" });
    expect(within(remote).getByText("origin/review").closest("button")).not.toHaveAttribute(
      "data-drop-branch",
    );

    // The branch under the pointer is marked.
    act(() =>
      useCommitDrag
        .getState()
        .set({ commits: [], x: 0, y: 0, over: "feature", insertAt: null, squashOnto: null }),
    );
    expect(within(local).getByText("feature").closest("button")).toHaveAttribute("data-drop-over");
    expect(within(local).getByText("main").closest("button")).not.toHaveAttribute("data-drop-over");

    // Done dragging: the list goes away again.
    act(() => useCommitDrag.getState().set(null));
    await waitFor(() => expect(screen.queryByRole("region", { name: "Branches" })).toBeNull());
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
    expect(commands.branchCreate).toHaveBeenCalledWith("/repo", "로그인-화면-개선", null);
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
    vi.mocked(commands.branchMergePreview).mockResolvedValue(ok({ commits: 3, conflicts: [] }));
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
  it("names the files a merge would conflict on and offers a way out", async () => {
    const user = userEvent.setup();
    setup();
    vi.mocked(commands.branchMergePreview).mockResolvedValue(
      ok({ commits: 2, conflicts: ["src/app.ts"] }),
    );
    vi.mocked(commands.branchMerge).mockResolvedValue({
      status: "error",
      error: { kind: "local_changes_would_be_overwritten", params: {}, detail: null },
    });
    vi.mocked(commands.branchUpdateFrom).mockResolvedValue(ok("merged"));
    await openPicker(user);
    await user.click(screen.getByRole("button", { name: "Merge into main…" }));

    const dialog = await screen.findByRole("dialog", { name: "Merge into main" });
    await user.click(within(dialog).getByRole("option", { name: "feature" }));
    expect(await within(dialog).findByText("1 file will conflict:")).toBeVisible();
    expect(within(dialog).getByText("src/app.ts")).toBeVisible();
    await user.click(within(dialog).getByRole("button", { name: "Merge and Resolve Conflicts" }));

    await user.click(
      await within(dialog).findByRole("button", { name: "Set changes aside and try again" }),
    );
    expect(commands.branchUpdateFrom).toHaveBeenCalledWith("/repo", "feature", "merge");
  });
});

describe("AutoStashBanner", () => {
  it("restores changes left on the branch", async () => {
    const user = userEvent.setup();
    vi.mocked(commands.stashFindAuto).mockResolvedValue(ok({ oid: "s1", branch: "main" }));
    vi.mocked(commands.stashApply).mockResolvedValue(ok("applied"));
    renderWithQuery(<AutoStashBanner repo="/repo" branch="main" />);
    await user.click(await screen.findByRole("button", { name: "Restore changes" }));
    expect(commands.stashApply).toHaveBeenCalledWith("/repo", "s1", true);
  });

  it("stays hidden when nothing was left behind", async () => {
    vi.mocked(commands.stashFindAuto).mockResolvedValue(ok(null));
    renderWithQuery(<AutoStashBanner repo="/repo" branch="main" />);
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByRole("button", { name: "Restore changes" })).not.toBeInTheDocument();
  });
});

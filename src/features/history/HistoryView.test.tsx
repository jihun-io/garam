import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { commands, type CommitDetail, type CommitSummary, type HistoryMarkers } from "../../ipc";
import { axeViolations } from "../../test/axe";
import { renderWithQuery } from "../../test/renderWithQuery";
import { useBranchDialog } from "../branches/branchDialogStore";
import { useCommitDrafts } from "../changes/commitDraftStore";
import { Notifications } from "../notify/Notifications";
import { useNotify } from "../notify/notifyStore";
import { runCommand } from "../../lib/commands";
import { DEFAULT_FILTER, useHistoryFilters } from "./filterStore";
import { useHistoryDialog } from "./historyDialogStore";
import { HistoryView } from "./HistoryView";

vi.mock("../../ipc/bindings", () => ({
  commands: {
    statusGet: vi.fn(),
    historyList: vi.fn(),
    historyMarkers: vi.fn(),
    branchList: vi.fn(),
    commitDetail: vi.fn(),
    commitFileDiff: vi.fn(),
    commitRevert: vi.fn(),
    commitCherryPick: vi.fn(),
    commitReset: vi.fn(),
    commitUndo: vi.fn(),
    commitCheckout: vi.fn(),
    tagCreate: vi.fn(),
  },
}));

const ok = <T,>(data: T) => ({ status: "ok" as const, data });
const now = Math.floor(Date.now() / 1000);

const commit = (n: number, extra: Partial<CommitSummary> = {}): CommitSummary => ({
  oid: `${n}`.repeat(40).slice(0, 40),
  parents: [],
  authorName: "김가람",
  authorEmail: "garam@example.com",
  authoredAt: now - n * 3600,
  summary: `Commit number ${n}`,
  ...extra,
});

const commits = [commit(1, { summary: "Add login screen" }), commit(2), commit(3)];

const detail = (c: CommitSummary): CommitDetail => ({
  ...c,
  body: "Explains why.",
  committerName: c.authorName,
  committedAt: c.authoredAt,
  files: [
    { path: "src/login.tsx", origPath: null, kind: "added" },
    { path: "README.md", origPath: null, kind: "modified" },
  ],
});

// main is one commit ahead of origin/main, which also has v1.
const markers: HistoryMarkers = {
  refs: [
    { oid: commits[0].oid, kind: "branch", name: "main", current: true },
    { oid: commits[1].oid, kind: "remote", name: "origin/main", current: false },
    { oid: commits[1].oid, kind: "tag", name: "v1", current: false },
  ],
  unpushed: [commits[0].oid],
  incoming: [],
};

function setup(historyMarkers: HistoryMarkers = markers) {
  vi.mocked(commands.statusGet).mockResolvedValue(
    ok({
      branch: { head: "main", oid: commits[0].oid, upstream: null, ahead: 0, behind: 0 },
      files: [],
    }),
  );
  vi.mocked(commands.historyList).mockResolvedValue(ok(commits));
  vi.mocked(commands.historyMarkers).mockResolvedValue(ok(historyMarkers));
  vi.mocked(commands.branchList).mockResolvedValue(
    ok([
      {
        name: "main",
        kind: "local",
        remote: null,
        oid: commits[0].oid,
        isHead: true,
        upstream: "origin/main",
        upstreamGone: false,
        ahead: 1,
        behind: 0,
        committedAt: now,
        subject: "Add login screen",
      },
      {
        name: "origin/main",
        kind: "remote",
        remote: "origin",
        oid: commits[1].oid,
        isHead: false,
        upstream: null,
        upstreamGone: false,
        ahead: 0,
        behind: 0,
        committedAt: now,
        subject: "Commit number 2",
      },
    ]),
  );
  vi.mocked(commands.commitDetail).mockImplementation(async (_repo, oid) =>
    ok(detail(commits.find((c) => c.oid === oid)!)),
  );
  vi.mocked(commands.commitFileDiff).mockImplementation(async (_repo, _oid, file) =>
    ok({
      type: "text",
      selectable: false,
      hunks: [
        {
          oldStart: 0,
          oldLines: 0,
          newStart: 1,
          newLines: 1,
          section: "",
          lines: [
            {
              kind: "added",
              text: `contents of ${file.path}`,
              oldLine: null,
              newLine: 1,
              noNewline: false,
              staged: false,
            },
          ],
        },
      ],
    }),
  );
  return renderWithQuery(
    <>
      <HistoryView repo="/repo" tabs={null} />
      <Notifications />
    </>,
  );
}

describe("HistoryView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useNotify.setState({ notice: null });
    useBranchDialog.setState({ dialog: null });
    useHistoryFilters.setState({ filters: {} });
    useHistoryDialog.setState({ dialog: null });
    useCommitDrafts.setState({ drafts: {} });
  });

  const openMenu = async (user: ReturnType<typeof userEvent.setup>, text: string) => {
    const list = await screen.findByRole("listbox", { name: "Commits" });
    await user.pointer({ keys: "[MouseRight]", target: await within(list).findByText(text) });
    return screen.findByRole("menu");
  };

  it("has no accessibility violations", async () => {
    const { container } = setup();
    await screen.findByRole("listbox", { name: "Commits" });
    await screen.findByRole("region", { name: "Diff" });
    expect(await axeViolations(container)).toEqual([]);
  });

  it("lists commits and shows the newest one", async () => {
    setup();
    const list = await screen.findByRole("listbox", { name: "Commits" });
    expect(await within(list).findAllByRole("option")).toHaveLength(3);
    expect(commands.historyList).toHaveBeenCalledWith("/repo", DEFAULT_FILTER, 0, 100);
    // Fewer than a page: nothing more to load.
    expect(commands.historyList).toHaveBeenCalledTimes(1);

    expect(await screen.findByRole("heading", { name: "Add login screen" })).toBeVisible();
    expect(screen.getByText("Explains why.")).toBeVisible();
    expect(screen.getByText("2 changed files")).toBeVisible();
    expect(await screen.findByText("contents of src/login.tsx")).toBeVisible();
  });

  it("marks refs and unpushed commits", async () => {
    setup();
    const list = await screen.findByRole("listbox", { name: "Commits" });
    const [first, second, third] = await within(list).findAllByRole("option");
    expect(await within(first).findByText("main")).toBeVisible();
    expect(first).toHaveAccessibleName(/Current branch main/);
    expect(first).toHaveAccessibleName(/Not pushed yet/);
    expect(second).toHaveAccessibleName(/Remote branch origin\/main.*Tag v1/);
    expect(second).not.toHaveAccessibleName(/Not pushed yet/);
    expect(third).toHaveAccessibleName("Commit number 3 김가람 · 3 hours ago");
  });

  it("folds a remote branch at the same commit into the local badge", async () => {
    setup({
      ...markers,
      refs: [
        { oid: commits[0].oid, kind: "branch", name: "main", current: true },
        { oid: commits[0].oid, kind: "remote", name: "origin/main", current: false },
      ],
      unpushed: [],
    });
    const list = await screen.findByRole("listbox", { name: "Commits" });
    const [first] = await within(list).findAllByRole("option");
    await within(first).findByText("main");
    expect(within(first).queryByText("origin/main")).toBeNull();
    expect(first).toHaveAccessibleName(/origin\/main also points here/);
  });

  it("shows commits waiting to be pulled above the branch", async () => {
    const user = userEvent.setup();
    const incoming = commit(9, { summary: "Teammate's fix", authoredAt: now });
    setup({ ...markers, incoming: [incoming] });
    vi.mocked(commands.commitDetail).mockImplementation(async (_repo, oid) =>
      ok(detail([incoming, ...commits].find((c) => c.oid === oid)!)),
    );

    const list = await screen.findByRole("listbox", { name: "Commits" });
    await within(list).findByText("Teammate's fix");
    await within(list).findByText("Add login screen");
    const options = within(list).getAllByRole("option");
    expect(options[0]).toHaveAccessibleName(/Not pulled yet/);
    // The branch's own newest commit stays selected.
    expect(options.find((o) => o.getAttribute("aria-selected") === "true")).toHaveTextContent(
      "Add login screen",
    );

    // An incoming commit can't be reverted from here.
    await user.pointer({ keys: "[MouseRight]", target: screen.getByText("Teammate's fix") });
    await screen.findByRole("menuitem", { name: "Copy commit hash" });
    expect(screen.queryByRole("menuitem", { name: "Revert this commit" })).toBeNull();
  });

  it("selects other commits and files", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(await screen.findByText("Commit number 2"));
    expect(await screen.findByRole("heading", { name: "Commit number 2" })).toBeVisible();

    await user.click(screen.getByRole("button", { name: /README\.md/ }));
    expect(await screen.findByText("contents of README.md")).toBeVisible();

    const list = screen.getByRole("listbox", { name: "Commits" });
    list.focus();
    await user.keyboard("{ArrowDown}");
    expect(await screen.findByRole("heading", { name: "Commit number 3" })).toBeVisible();
  });

  it("copies the commit hash", async () => {
    const user = userEvent.setup();
    setup();
    await screen.findByRole("heading", { name: "Add login screen" });
    await user.click(screen.getByRole("button", { name: "Copy commit hash 1111111" }));
    expect(await navigator.clipboard.readText()).toBe(commits[0].oid);
    expect(await screen.findByText("Copied 1111111.")).toBeVisible();
  });

  it("reverts a commit from its context menu", async () => {
    const user = userEvent.setup();
    vi.mocked(commands.commitRevert).mockResolvedValue(ok(null));
    setup();
    await user.pointer({
      keys: "[MouseRight]",
      target: await screen.findByText("Commit number 2"),
    });
    await user.click(await screen.findByRole("menuitem", { name: "Revert this commit" }));
    expect(commands.commitRevert).toHaveBeenCalledWith("/repo", commits[1].oid);
    expect(await screen.findByText("Reverted “Commit number 2” with a new commit.")).toBeVisible();
  });

  it("starts a branch from a commit", async () => {
    const user = userEvent.setup();
    setup();
    await user.pointer({
      keys: "[MouseRight]",
      target: await screen.findByText("Commit number 3"),
    });
    await user.click(await screen.findByRole("menuitem", { name: "Create branch from commit…" }));
    expect(useBranchDialog.getState().dialog).toEqual({ kind: "create", from: commits[2] });
  });

  it("searches after typing settles and hides incoming commits", async () => {
    const user = userEvent.setup();
    setup({ ...markers, incoming: [commit(9, { summary: "Teammate's fix" })] });
    await screen.findByText("Teammate's fix");

    vi.mocked(commands.historyList).mockResolvedValue(ok([commits[2]]));
    const search = screen.getByRole("searchbox", { name: "Search commits" });
    await user.type(search, "number 3");
    await waitFor(() =>
      expect(commands.historyList).toHaveBeenLastCalledWith(
        "/repo",
        { ...DEFAULT_FILTER, query: "number 3" },
        0,
        100,
      ),
    );
    // Typing runs one search, not one per keystroke.
    expect(
      vi.mocked(commands.historyList).mock.calls.filter(([, f]) => f.query !== ""),
    ).toHaveLength(1);
    const list = screen.getByRole("listbox", { name: "Commits" });
    await waitFor(() => expect(within(list).getAllByRole("option")).toHaveLength(1));
    expect(within(list).queryByText("Teammate's fix")).toBeNull();
    expect(await screen.findByRole("heading", { name: "Commit number 3" })).toBeVisible();

    // Escape clears the search.
    await user.keyboard("{Escape}");
    expect(search).toHaveValue("");
  });

  it("narrows by search field, scope, path and first parent", async () => {
    const user = userEvent.setup();
    setup();
    await screen.findByRole("heading", { name: "Add login screen" });

    await user.click(screen.getByRole("button", { name: "Filter" }));
    const panel = await screen.findByRole("dialog", { name: "Filter" });
    expect(await axeViolations(panel)).toEqual([]);
    await user.click(within(panel).getByRole("radio", { name: "Author" }));
    expect(screen.getByRole("searchbox")).toHaveAttribute(
      "placeholder",
      "Search author name or email",
    );

    await user.click(within(panel).getByRole("combobox", { name: "Scope" }));
    await user.click(await screen.findByRole("option", { name: "origin/main" }));
    await user.type(within(panel).getByRole("textbox", { name: "Path" }), "src/");
    await user.click(
      within(panel).getByRole("checkbox", { name: "Follow only the first parent of merges" }),
    );

    await waitFor(() =>
      expect(commands.historyList).toHaveBeenLastCalledWith(
        "/repo",
        {
          scope: { kind: "ref", refname: "refs/remotes/origin/main" },
          query: "",
          searchIn: "author",
          path: "src/",
          firstParent: true,
        },
        0,
        100,
      ),
    );
    expect(screen.getByRole("button", { name: "Filter (on)" })).toBeVisible();

    // Back to the plain history at once, from the cache.
    const calls = vi.mocked(commands.historyList).mock.calls.length;
    await user.click(within(panel).getByRole("button", { name: "Reset filters" }));
    expect(await screen.findByRole("button", { name: "Filter" })).toBeVisible();
    expect(within(panel).getByRole("textbox", { name: "Path" })).toHaveValue("");
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(commands.historyList).toHaveBeenCalledTimes(calls);
  });

  it("offers to clear a search that finds nothing", async () => {
    const user = userEvent.setup();
    setup();
    await screen.findByRole("heading", { name: "Add login screen" });
    vi.mocked(commands.historyList).mockResolvedValue(ok([]));
    await user.type(screen.getByRole("searchbox"), "zzz");
    expect(await screen.findByText("No commits match.")).toBeVisible();

    vi.mocked(commands.historyList).mockResolvedValue(ok(commits));
    await user.click(screen.getByRole("button", { name: "Clear search and filters" }));
    expect(screen.getByRole("searchbox")).toHaveValue("");
    expect(await screen.findByRole("heading", { name: "Add login screen" })).toBeVisible();
  });

  it("focuses the search from the Search History command", async () => {
    setup();
    await screen.findByRole("heading", { name: "Add login screen" });
    expect(runCommand("history.search")).toBe(true);
    expect(screen.getByRole("searchbox")).toHaveFocus();
  });

  it("offers undo only on an unpushed last commit, and cherry-pick only off HEAD", async () => {
    const user = userEvent.setup();
    setup({ ...markers, incoming: [commit(9, { summary: "Teammate's fix" })] });
    await screen.findByText("Teammate's fix");

    let menu = await openMenu(user, "Add login screen");
    expect(within(menu).getByRole("menuitem", { name: "Undo Last Commit" })).toBeVisible();
    expect(within(menu).queryByRole("menuitem", { name: /Cherry-pick/ })).toBeNull();
    await user.keyboard("{Escape}");

    menu = await openMenu(user, "Commit number 2");
    expect(within(menu).queryByRole("menuitem", { name: "Undo Last Commit" })).toBeNull();
    expect(within(menu).getByRole("menuitem", { name: "Reset to This Commit…" })).toBeVisible();
    await user.keyboard("{Escape}");

    menu = await openMenu(user, "Teammate's fix");
    expect(
      within(menu).getByRole("menuitem", { name: "Cherry-pick onto Current Branch" }),
    ).toBeVisible();
  });

  it("undoes the last commit and keeps its message for the commit form", async () => {
    const user = userEvent.setup();
    vi.mocked(commands.commitUndo).mockResolvedValue(
      ok({ oid: commits[0].oid, summary: "Add login screen", body: "Explains why." }),
    );
    setup();
    const menu = await openMenu(user, "Add login screen");
    await user.click(within(menu).getByRole("menuitem", { name: "Undo Last Commit" }));
    expect(commands.commitUndo).toHaveBeenCalledWith("/repo", commits[0].oid);
    expect(
      await screen.findByText("Undid the last commit. Its changes and message are still here."),
    ).toBeVisible();
    expect(useCommitDrafts.getState().drafts["/repo"]).toEqual({
      summary: "Add login screen",
      description: "Explains why.",
    });
  });

  it("cherry-picks and explains an empty pick", async () => {
    const user = userEvent.setup();
    vi.mocked(commands.commitCherryPick)
      .mockResolvedValueOnce(ok(null))
      .mockResolvedValueOnce({
        status: "error",
        error: { kind: "cherry_pick_empty", params: {}, detail: null },
      });
    setup({ ...markers, incoming: [commit(9, { summary: "Teammate's fix" })] });

    let menu = await openMenu(user, "Teammate's fix");
    await user.click(within(menu).getByRole("menuitem", { name: /Cherry-pick/ }));
    expect(commands.commitCherryPick).toHaveBeenCalledWith("/repo", commit(9).oid);
    expect(await screen.findByText("Cherry-picked “Teammate's fix”.")).toBeVisible();

    menu = await openMenu(user, "Teammate's fix");
    await user.click(within(menu).getByRole("menuitem", { name: /Cherry-pick/ }));
    expect(
      await screen.findByText(
        "This branch already has these changes, so there was nothing to cherry-pick.",
      ),
    ).toBeVisible();
  });

  it("resets after choosing what to keep, warning before discarding", async () => {
    const user = userEvent.setup();
    vi.mocked(commands.commitReset).mockResolvedValue(ok(null));
    setup();
    vi.mocked(commands.statusGet).mockResolvedValue(
      ok({
        branch: { head: "main", oid: commits[0].oid, upstream: null, ahead: 0, behind: 0 },
        files: [
          {
            path: "a.txt",
            origPath: null,
            staged: null,
            unstaged: "modified",
            isSubmodule: false,
          },
        ],
      }),
    );
    const menu = await openMenu(user, "Commit number 2");
    await user.click(within(menu).getByRole("menuitem", { name: "Reset to This Commit…" }));

    const dialog = await screen.findByRole("dialog", { name: "Reset to This Commit" });
    expect(
      within(dialog).getByText(/Moves the current branch main to “Commit number 2”/),
    ).toBeVisible();
    expect(
      within(dialog).getByRole("radio", { name: /Keep changes in the working folder/ }),
    ).toBeChecked();
    expect(await axeViolations(dialog)).toEqual([]);

    await user.click(within(dialog).getByRole("radio", { name: /Discard changes/ }));
    expect(
      await within(dialog).findByText(
        "1 file with uncommitted changes will also lose its current state.",
      ),
    ).toBeVisible();
    await user.click(within(dialog).getByRole("button", { name: "Reset and Discard Changes" }));
    expect(commands.commitReset).toHaveBeenCalledWith("/repo", commits[1].oid, "hard");
    expect(await screen.findByText("Reset to “Commit number 2”.")).toBeVisible();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("checks out a commit, or starts a branch there instead", async () => {
    const user = userEvent.setup();
    vi.mocked(commands.commitCheckout).mockResolvedValue(ok(null));
    setup();
    let menu = await openMenu(user, "Commit number 3");
    await user.click(within(menu).getByRole("menuitem", { name: "Check Out This Commit…" }));
    let dialog = await screen.findByRole("dialog", { name: "Check Out This Commit" });
    expect(within(dialog).getByText(/detached HEAD/)).toBeVisible();
    await user.click(within(dialog).getByRole("button", { name: "Check Out" }));
    expect(commands.commitCheckout).toHaveBeenCalledWith("/repo", commits[2].oid);
    expect(await screen.findByText(/Checked out “Commit number 3”/)).toBeVisible();

    menu = await openMenu(user, "Commit number 3");
    await user.click(within(menu).getByRole("menuitem", { name: "Check Out This Commit…" }));
    dialog = await screen.findByRole("dialog", { name: "Check Out This Commit" });
    await user.click(within(dialog).getByRole("button", { name: "Create Branch Here…" }));
    expect(useBranchDialog.getState().dialog).toEqual({ kind: "create", from: commits[2] });
  });

  it("creates a tag, showing git's refusal in the dialog", async () => {
    const user = userEvent.setup();
    vi.mocked(commands.tagCreate)
      .mockResolvedValueOnce({
        status: "error",
        error: { kind: "tag_exists", params: {}, detail: null },
      })
      .mockResolvedValueOnce(ok(null));
    setup();
    const menu = await openMenu(user, "Commit number 2");
    await user.click(within(menu).getByRole("menuitem", { name: "Create Tag Here…" }));
    const dialog = await screen.findByRole("dialog", { name: "Create Tag" });
    const submit = within(dialog).getByRole("button", { name: "Create Tag" });
    expect(submit).toBeDisabled();

    await user.type(within(dialog).getByRole("textbox", { name: "Tag name" }), " v1.0 ");
    await user.type(within(dialog).getByRole("textbox", { name: "Message (optional)" }), "First");
    await user.click(submit);
    expect(commands.tagCreate).toHaveBeenLastCalledWith("/repo", "v1.0", commits[1].oid, "First");
    expect(await within(dialog).findByText("A tag with this name already exists.")).toBeVisible();

    await user.click(submit);
    expect(await screen.findByText("Created tag v1.0.")).toBeVisible();
  });

  it("explains an empty history", async () => {
    setup();
    vi.mocked(commands.historyList).mockResolvedValue(ok([]));
    vi.mocked(commands.statusGet).mockResolvedValue(
      ok({ branch: { head: "main", oid: null, upstream: null, ahead: 0, behind: 0 }, files: [] }),
    );
    expect(await screen.findByText("No commits yet.")).toBeVisible();
  });
});

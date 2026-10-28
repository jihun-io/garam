import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { save } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  commands,
  type CommitDetail,
  type CommitSummary,
  type FileChange,
  type HistoryMarkers,
} from "../../ipc";
import { axeViolations } from "../../test/axe";
import { renderWithQuery } from "../../test/renderWithQuery";
import { useBranchDialog } from "../branches/branchDialogStore";
import { useCommitDrafts } from "../changes/commitDraftStore";
import { Notifications } from "../notify/Notifications";
import { useNotify } from "../notify/notifyStore";
import { runCommand } from "../../lib/commands";
import { currentPlatform } from "../../lib/platform";
import { DEFAULT_FILTER, useHistoryFilters } from "./filterStore";
import { useHistoryDialog } from "./historyDialogStore";
import { useHistoryPane } from "./historyPaneStore";
import { HistoryView } from "./HistoryView";
import { SquashUndoDialog } from "./SquashUndo";
import { squashUndoKey, useSquashUndoDialog } from "./squashUndoStore";

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn(async () => {}) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => false,
  Channel: class {
    onmessage = () => {};
  },
}));
vi.mock("../../ipc/bindings", () => ({
  commands: {
    statusGet: vi.fn(),
    historyList: vi.fn(),
    historyMarkers: vi.fn(),
    historyPreparePaths: vi.fn(),
    tagList: vi.fn(),
    remoteTagStates: vi.fn(),
    remoteTagPush: vi.fn(),
    settingsGet: vi.fn(),
    settingsSet: vi.fn(),
    branchList: vi.fn(),
    commitDetail: vi.fn(),
    commitFileDiff: vi.fn(),
    commitRevert: vi.fn(),
    commitCherryPick: vi.fn(),
    commitSquash: vi.fn(),
    squashUndoGet: vi.fn(),
    squashUndo: vi.fn(),
    commitSquashOnto: vi.fn(),
    commitReword: vi.fn(),
    commitFixupPreview: vi.fn(),
    commitFixup: vi.fn(),
    commitCheck: vi.fn(),
    amendBegin: vi.fn(),
    commitCherryPickOnto: vi.fn(),
    commitReorder: vi.fn(),
    commitReset: vi.fn(),
    commitUndo: vi.fn(),
    commitCheckout: vi.fn(),
    tagCreate: vi.fn(),
    tagDelete: vi.fn(),
    remoteTagDelete: vi.fn(),
    commitImages: vi.fn(),
    commitSignature: vi.fn(),
    commitPatch: vi.fn(),
    commitPatchSave: vi.fn(),
    remoteInfo: vi.fn(),
    compareGet: vi.fn(),
    compareFileDiff: vi.fn(),
    compareImages: vi.fn(),
    stashFiles: vi.fn(),
    stashFileDiff: vi.fn(),
    stashApply: vi.fn(),
    lostCommits: vi.fn(),
    operationCancel: vi.fn(),
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
  stashes: [],
};

function setup(historyMarkers: HistoryMarkers = markers, files: FileChange[] = []) {
  vi.mocked(commands.squashUndoGet).mockResolvedValue(ok(null));
  vi.mocked(commands.statusGet).mockResolvedValue(
    ok({
      branch: { head: "main", oid: commits[0].oid, upstream: null, ahead: 0, behind: 0 },
      files,
      unpushedTags: [],
    }),
  );
  vi.mocked(commands.historyList).mockResolvedValue(ok(commits));
  vi.mocked(commands.historyPreparePaths).mockResolvedValue(ok(true));
  vi.mocked(commands.historyMarkers).mockResolvedValue(ok(historyMarkers));
  vi.mocked(commands.commitSignature).mockResolvedValue(
    ok({ status: "none", signer: null, key: null }),
  );
  vi.mocked(commands.remoteInfo).mockResolvedValue(
    ok({
      remotes: [{ name: "origin", url: "git@github.com:garam/app.git" }],
      defaultRemote: "origin",
      lastFetchedAt: null,
    }),
  );
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
      <SquashUndoDialog />
    </>,
  );
}

describe("HistoryView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useNotify.setState({ notice: null });
    useSquashUndoDialog.setState({ request: null });
    useBranchDialog.setState({ dialog: null });
    useHistoryFilters.setState({ filters: {} });
    useHistoryDialog.setState({ dialog: null });
    useCommitDrafts.setState({ drafts: {} });
    useHistoryPane.setState({ panes: {} });
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

  it("resizes the file list beside the diff and remembers it", async () => {
    const user = userEvent.setup();
    vi.mocked(commands.settingsSet).mockResolvedValue(ok(null));
    // jsdom lays nothing out; give the split room for a wider list.
    const width = vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1000);
    setup();
    const handle = await screen.findByRole("separator", { name: "Resize file list" });
    expect(handle).toHaveAttribute("aria-valuenow", "260");
    expect(handle).toHaveAttribute("aria-valuemax", "560");
    handle.focus();
    await user.keyboard("{ArrowRight}");
    expect(vi.mocked(commands.settingsSet).mock.lastCall![0].detailFilesWidth).toBe(276);
    expect(document.documentElement.style.getPropertyValue("--detail-files-width")).toBe("276px");
    width.mockRestore();
  });

  it("lists commits and shows the newest one", async () => {
    setup();
    const list = await screen.findByRole("listbox", { name: "Commits" });
    expect(await within(list).findAllByRole("option")).toHaveLength(3);
    expect(commands.historyList).toHaveBeenCalledWith(
      expect.any(String),
      "/repo",
      DEFAULT_FILTER,
      0,
      100,
    );
    // Fewer than a page: nothing more to load.
    expect(commands.historyList).toHaveBeenCalledTimes(1);

    expect(await screen.findByRole("heading", { name: "Add login screen" })).toBeVisible();
    expect(screen.getByText("Explains why.")).toBeVisible();
    expect(screen.getByText("2 changed files")).toBeVisible();
    expect(await screen.findByText("contents of src/login.tsx")).toBeVisible();
  });

  it("focuses a clicked detail file while keeping the commit selected", async () => {
    setup();
    const files = await screen.findByRole("navigation", { name: "2 changed files" });
    const file = within(files).getAllByRole("button")[0];
    const commits = screen.getByRole("listbox", { name: "Commits" });
    commits.focus();
    // fireEvent does not synthesize focus like user-event does. The app
    // must do it for WebKit's button behavior.
    fireEvent.click(file);
    expect(file).toHaveFocus();
    expect(within(commits).getByRole("option", { selected: true })).toBeInTheDocument();
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
    expect(commands.commitRevert).toHaveBeenCalledWith("/repo", [commits[1].oid]);
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
        expect.any(String),
        "/repo",
        { ...DEFAULT_FILTER, query: "number 3" },
        0,
        100,
      ),
    );
    // Typing runs one search, not one per keystroke.
    expect(
      vi.mocked(commands.historyList).mock.calls.filter(([, , f]) => f.query !== ""),
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
    // Path filters get Bloom filters written once, in the background.
    expect(commands.historyPreparePaths).not.toHaveBeenCalled();
    await user.type(within(panel).getByRole("textbox", { name: "Path" }), "src/");
    await user.click(
      within(panel).getByRole("checkbox", { name: "Follow only the first parent of merges" }),
    );

    await waitFor(() =>
      expect(commands.historyList).toHaveBeenLastCalledWith(
        expect.any(String),
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
    expect(commands.historyPreparePaths).toHaveBeenCalledTimes(1);
    expect(commands.historyPreparePaths).toHaveBeenCalledWith("/repo");

    // Back to the plain history at once, from the cache.
    const calls = vi.mocked(commands.historyList).mock.calls.length;
    await user.click(within(panel).getByRole("button", { name: "Reset filters" }));
    expect(await screen.findByRole("button", { name: "Filter" })).toBeVisible();
    expect(within(panel).getByRole("textbox", { name: "Path" })).toHaveValue("");
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(commands.historyList).toHaveBeenCalledTimes(calls);
  });

  it("stops a slow search when the search changes", async () => {
    const user = userEvent.setup();
    setup();
    await screen.findByRole("heading", { name: "Add login screen" });
    // The first search never finishes, like a code search in a huge history.
    vi.mocked(commands.historyList).mockReturnValue(new Promise(() => {}));
    const search = screen.getByRole("searchbox", { name: "Search commits" });
    await user.type(search, "slow");
    await waitFor(() =>
      expect(commands.historyList).toHaveBeenLastCalledWith(
        expect.any(String),
        "/repo",
        { ...DEFAULT_FILTER, query: "slow" },
        0,
        100,
      ),
    );
    const slowId = vi.mocked(commands.historyList).mock.lastCall![0];
    expect(commands.operationCancel).not.toHaveBeenCalled();

    vi.mocked(commands.historyList).mockResolvedValue(ok([commits[2]]));
    await user.type(search, "er");
    await waitFor(() => expect(commands.operationCancel).toHaveBeenCalledWith(slowId));
    expect(vi.mocked(commands.historyList).mock.lastCall![0]).not.toBe(slowId);
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
    expect(
      within(menu).queryByRole("menuitem", { name: "Cherry-pick onto Current Branch" }),
    ).toBeNull();
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

  it("edits the complete message and preserves trailers while guarding IME submission", async () => {
    const user = userEvent.setup();
    setup();
    const body = "Explains why.\n\nCo-authored-by: Teammate <team@example.com>";
    vi.mocked(commands.commitDetail).mockResolvedValue(ok({ ...detail(commits[0]), body }));
    vi.mocked(commands.commitReword).mockResolvedValue(ok("a".repeat(40)));
    const menu = await openMenu(user, "Add login screen");
    await user.click(within(menu).getByRole("menuitem", { name: "Edit Commit Message…" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit Commit Message" });
    const summary = within(dialog).getByRole("textbox", { name: "Summary" });
    const description = within(dialog).getByRole("textbox", { name: "Description" });
    const save = within(dialog).getByRole("button", { name: "Save Message" });
    expect(summary).toHaveValue("Add login screen");
    expect(description).toHaveValue(body);
    expect(save).toBeDisabled();
    await user.clear(summary);
    expect(save).toBeDisabled();
    await user.type(summary, "로그인 화면 추가");
    expect(fireEvent.keyDown(summary, { key: "Enter", ctrlKey: true, isComposing: true })).toBe(
      false,
    );
    expect(fireEvent.keyDown(summary, { key: "Enter", metaKey: true, keyCode: 229 })).toBe(false);
    expect(commands.commitReword).not.toHaveBeenCalled();
    expect(await axeViolations(dialog)).toEqual([]);
    await user.click(save);
    expect(commands.commitReword).toHaveBeenCalledWith(
      "/repo",
      commits[0].oid,
      commits[0].oid,
      "main",
      `로그인 화면 추가\n\n${body}`,
    );
    expect(await screen.findByText("Updated the commit message.")).toBeVisible();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("focuses the summary when an older commit's message finishes loading", async () => {
    const user = userEvent.setup();
    setup({ ...markers, unpushed: [commits[0].oid, commits[1].oid] });
    vi.mocked(commands.historyList).mockResolvedValue(
      ok([{ ...commits[0], parents: [commits[1].oid] }, commits[1], commits[2]]),
    );
    let resolveDetail!: (value: ReturnType<typeof ok<CommitDetail>>) => void;
    const pending = new Promise<ReturnType<typeof ok<CommitDetail>>>((resolve) => {
      resolveDetail = resolve;
    });
    vi.mocked(commands.commitDetail).mockImplementation(async (_repo, oid) =>
      oid === commits[1].oid ? pending : ok(detail(commits[0])),
    );
    const menu = await openMenu(user, "Commit number 2");
    await user.click(within(menu).getByRole("menuitem", { name: "Edit Commit Message…" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit Commit Message" });
    expect(within(dialog).getByRole("button", { name: "Save Message" })).toBeDisabled();
    await act(async () => resolveDetail(ok(detail(commits[1]))));
    await waitFor(() =>
      expect(within(dialog).getByRole("textbox", { name: "Summary" })).toHaveFocus(),
    );
  });

  it("keeps edits after a stale-HEAD failure until cancelled", async () => {
    const user = userEvent.setup();
    setup();
    vi.mocked(commands.commitReword).mockResolvedValueOnce({
      status: "error",
      error: { kind: "head_moved", params: {}, detail: null },
    });
    const menu = await openMenu(user, "Add login screen");
    await user.click(within(menu).getByRole("menuitem", { name: "Edit Commit Message…" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit Commit Message" });
    const summary = within(dialog).getByRole("textbox", { name: "Summary" });
    await user.clear(summary);
    await user.type(summary, "Corrected message");
    await user.click(within(dialog).getByRole("button", { name: "Save Message" }));
    await waitFor(() => expect(within(dialog).getByRole("alert")).toBeVisible());
    expect(summary).toHaveValue("Corrected message");
    expect(within(dialog).getByRole("button", { name: "Save Message" })).toBeEnabled();
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(commands.commitReword).toHaveBeenCalledTimes(1);
  });

  it("offers reword for older unpushed commits and hides it for pushed commits", async () => {
    const user = userEvent.setup();
    setup({ ...markers, unpushed: [commits[0].oid, commits[1].oid] });
    const linear = [
      { ...commits[0], parents: [commits[1].oid] },
      { ...commits[1], parents: [commits[2].oid] },
      commits[2],
    ];
    vi.mocked(commands.historyList).mockResolvedValue(ok(linear));
    let menu = await openMenu(user, "Commit number 2");
    expect(within(menu).getByRole("menuitem", { name: "Edit Commit Message…" })).toBeVisible();
    await user.keyboard("{Escape}");
    menu = await openMenu(user, "Commit number 3");
    expect(within(menu).queryByRole("menuitem", { name: "Edit Commit Message…" })).toBeNull();
  });

  it("hides reword when a merge lies between HEAD and the commit", async () => {
    const user = userEvent.setup();
    setup({ ...markers, unpushed: commits.map((c) => c.oid) });
    vi.mocked(commands.historyList).mockResolvedValue(
      ok([{ ...commits[0], parents: [commits[1].oid, "a".repeat(40)] }, ...commits.slice(1)]),
    );
    const menu = await openMenu(user, "Commit number 2");
    expect(within(menu).queryByRole("menuitem", { name: "Edit Commit Message…" })).toBeNull();
  });

  const stagedFile: FileChange = {
    path: "src/login.tsx",
    origPath: null,
    staged: "modified",
    unstaged: "modified",
    isSubmodule: false,
  };
  const fixupTree = "a".repeat(40);

  it("confirms staged files and runs safety checks before fixing up an unpublished commit", async () => {
    const user = userEvent.setup();
    setup({ ...markers, unpushed: [commits[0].oid, commits[1].oid] }, [stagedFile]);
    vi.mocked(commands.historyList).mockResolvedValue(
      ok([
        { ...commits[0], parents: [commits[1].oid] },
        { ...commits[1], parents: [commits[2].oid] },
        commits[2],
      ]),
    );
    vi.mocked(commands.commitFixupPreview).mockResolvedValue(
      ok({ tree: fixupTree, paths: [stagedFile.path] }),
    );
    vi.mocked(commands.commitCheck).mockResolvedValue(ok([]));
    vi.mocked(commands.commitFixup).mockResolvedValue(ok(commits[0].oid));
    const menu = await openMenu(user, "Commit number 2");
    await user.click(
      within(menu).getByRole("menuitem", { name: "Add staged changes to this commit…" }),
    );
    const dialog = await screen.findByRole("dialog", { name: "Add changes to this commit" });
    expect(await within(dialog).findByText(stagedFile.path)).toBeVisible();
    expect(commands.commitFixup).not.toHaveBeenCalled();
    expect(await axeViolations(dialog)).toEqual([]);
    await user.click(within(dialog).getByRole("button", { name: "Add changes" }));
    await waitFor(() =>
      expect(commands.commitFixup).toHaveBeenCalledWith(
        "/repo",
        commits[1].oid,
        commits[0].oid,
        "main",
        fixupTree,
      ),
    );
    expect(commands.commitCheck).toHaveBeenCalledWith("/repo");
    expect(await screen.findByText("Staged changes added to the commit.")).toBeVisible();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("requires acknowledgement of safety findings before adding changes", async () => {
    const user = userEvent.setup();
    setup({ ...markers, unpushed: [commits[0].oid, commits[1].oid] }, [stagedFile]);
    vi.mocked(commands.historyList).mockResolvedValue(
      ok([
        { ...commits[0], parents: [commits[1].oid] },
        { ...commits[1], parents: [commits[2].oid] },
        commits[2],
      ]),
    );
    vi.mocked(commands.commitFixupPreview).mockResolvedValue(
      ok({ tree: fixupTree, paths: [stagedFile.path] }),
    );
    vi.mocked(commands.commitCheck).mockResolvedValue(
      ok([
        { kind: "secret", path: stagedFile.path, secret: "private_key", line: 1, preview: null },
      ]),
    );
    vi.mocked(commands.commitFixup).mockResolvedValue(ok(commits[0].oid));
    const menu = await openMenu(user, "Commit number 2");
    await user.click(
      within(menu).getByRole("menuitem", { name: "Add staged changes to this commit…" }),
    );
    const dialog = await screen.findByRole("dialog", { name: "Add changes to this commit" });
    await within(dialog).findByText(stagedFile.path);
    await user.click(within(dialog).getByRole("button", { name: "Add changes" }));
    const checks = await screen.findByRole("dialog", { name: "Check before committing" });
    expect(commands.commitFixup).not.toHaveBeenCalled();
    await user.click(within(checks).getByRole("button", { name: "Add anyway" }));
    await waitFor(() => expect(commands.commitFixup).toHaveBeenCalledTimes(1));
  });

  it("requires explicit review after the staged tree changes", async () => {
    const user = userEvent.setup();
    setup({ ...markers, unpushed: [commits[0].oid, commits[1].oid] }, [stagedFile]);
    vi.mocked(commands.historyList).mockResolvedValue(
      ok([
        { ...commits[0], parents: [commits[1].oid] },
        { ...commits[1], parents: [commits[2].oid] },
        commits[2],
      ]),
    );
    vi.mocked(commands.commitFixupPreview).mockResolvedValue(
      ok({ tree: fixupTree, paths: [stagedFile.path] }),
    );
    vi.mocked(commands.commitCheck).mockResolvedValue(ok([]));
    vi.mocked(commands.commitFixup).mockResolvedValueOnce({
      status: "error",
      error: { kind: "index_changed", params: {}, detail: null },
    });
    const menu = await openMenu(user, "Commit number 2");
    await user.click(
      within(menu).getByRole("menuitem", { name: "Add staged changes to this commit…" }),
    );
    const dialog = await screen.findByRole("dialog", { name: "Add changes to this commit" });
    await within(dialog).findByText(stagedFile.path);
    await user.click(within(dialog).getByRole("button", { name: "Add changes" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "The staged changes changed",
    );
    vi.mocked(commands.commitFixupPreview).mockResolvedValue(
      ok({ tree: "b".repeat(40), paths: ["new.txt"] }),
    );
    await user.click(within(dialog).getByRole("button", { name: "Review staged changes again" }));
    expect(await within(dialog).findByText("new.txt")).toBeVisible();
    expect(commands.commitFixup).toHaveBeenCalledTimes(1);
  });

  it("leaves the dialog on a stale head and opens Changes when a saved fixup stops", async () => {
    const user = userEvent.setup();
    setup({ ...markers, unpushed: [commits[0].oid, commits[1].oid] }, [stagedFile]);
    vi.mocked(commands.historyList).mockResolvedValue(
      ok([
        { ...commits[0], parents: [commits[1].oid] },
        { ...commits[1], parents: [commits[2].oid] },
        commits[2],
      ]),
    );
    vi.mocked(commands.commitFixupPreview).mockResolvedValue(
      ok({ tree: fixupTree, paths: [stagedFile.path] }),
    );
    vi.mocked(commands.commitCheck).mockResolvedValue(ok([]));
    vi.mocked(commands.commitFixup)
      .mockResolvedValueOnce({
        status: "error",
        error: { kind: "head_moved", params: {}, detail: null },
      })
      .mockResolvedValueOnce({
        status: "error",
        error: { kind: "fixup_incomplete", params: {}, detail: "rebase conflict" },
      });
    const menu = await openMenu(user, "Commit number 2");
    await user.click(
      within(menu).getByRole("menuitem", { name: "Add staged changes to this commit…" }),
    );
    const dialog = await screen.findByRole("dialog", { name: "Add changes to this commit" });
    await within(dialog).findByText(stagedFile.path);
    await user.click(within(dialog).getByRole("button", { name: "Add changes" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("The last commit changed");
    await user.click(within(dialog).getByRole("button", { name: "Add changes" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(await screen.findByText(/Git saved your changes, but the fixup/)).toBeVisible();
  });

  it("opens the last commit in the amend editor instead of offering fixup", async () => {
    const user = userEvent.setup();
    setup(markers, [stagedFile]);
    vi.mocked(commands.amendBegin).mockResolvedValue(
      ok({ id: "abcd", head: { oid: commits[0].oid, summary: commits[0].summary, body: "" } }),
    );
    const menu = await openMenu(user, "Add login screen");
    expect(
      within(menu).queryByRole("menuitem", { name: "Add staged changes to this commit…" }),
    ).toBeNull();
    await user.click(within(menu).getByRole("menuitem", { name: "Edit Commit…" }));
    await waitFor(() => expect(commands.amendBegin).toHaveBeenCalledWith("/repo", commits[0].oid));
  });

  it("hides fixup without staged changes", async () => {
    const user = userEvent.setup();
    setup();
    let menu = await openMenu(user, "Add login screen");
    expect(
      within(menu).queryByRole("menuitem", { name: "Add staged changes to this commit…" }),
    ).toBeNull();
    await user.keyboard("{Escape}");
    menu = await openMenu(user, "Commit number 2");
    expect(
      within(menu).queryByRole("menuitem", { name: "Add staged changes to this commit…" }),
    ).toBeNull();
  });

  it("offers fixup on older unpublished commits but hides published commits", async () => {
    const user = userEvent.setup();
    setup({ ...markers, unpushed: [commits[0].oid, commits[1].oid] }, [stagedFile]);
    vi.mocked(commands.historyList).mockResolvedValue(
      ok([
        { ...commits[0], parents: [commits[1].oid] },
        { ...commits[1], parents: [commits[2].oid] },
        commits[2],
      ]),
    );
    let menu = await openMenu(user, "Commit number 2");
    expect(
      within(menu).getByRole("menuitem", { name: "Add staged changes to this commit…" }),
    ).toBeVisible();
    await user.keyboard("{Escape}");
    menu = await openMenu(user, "Commit number 3");
    expect(
      within(menu).queryByRole("menuitem", { name: "Add staged changes to this commit…" }),
    ).toBeNull();
  });

  it("hides fixup when a merge lies between the target and HEAD", async () => {
    const user = userEvent.setup();
    setup({ ...markers, unpushed: commits.map((c) => c.oid) }, [stagedFile]);
    vi.mocked(commands.historyList).mockResolvedValue(
      ok([{ ...commits[0], parents: [commits[1].oid, "a".repeat(40)] }, ...commits.slice(1)]),
    );
    const menu = await openMenu(user, "Commit number 2");
    expect(
      within(menu).queryByRole("menuitem", { name: "Add staged changes to this commit…" }),
    ).toBeNull();
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
      .mockResolvedValueOnce(ok({ picked: 1, skipped: 0 }))
      .mockResolvedValueOnce({
        status: "error",
        error: { kind: "cherry_pick_empty", params: {}, detail: null },
      });
    setup({ ...markers, incoming: [commit(9, { summary: "Teammate's fix" })] });

    let menu = await openMenu(user, "Teammate's fix");
    await user.click(
      within(menu).getByRole("menuitem", { name: "Cherry-pick onto Current Branch" }),
    );
    expect(commands.commitCherryPick).toHaveBeenCalledWith("/repo", [commit(9).oid]);
    expect(await screen.findByText("Cherry-picked “Teammate's fix”.")).toBeVisible();

    menu = await openMenu(user, "Teammate's fix");
    await user.click(
      within(menu).getByRole("menuitem", { name: "Cherry-pick onto Current Branch" }),
    );
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
        unpushedTags: [],
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

  describe("tags and the remote", () => {
    const V1 = {
      name: "v1",
      oid: commits[1].oid,
      target: commits[1].oid,
      annotated: false,
      message: null,
      summary: "Commit number 2",
      createdAt: now - 60,
      unpushed: false,
    };
    const withStates = (sync: "same" | "missing" | "differs") => {
      vi.mocked(commands.tagList).mockResolvedValue(ok([V1]));
      vi.mocked(commands.remoteTagStates).mockResolvedValue(ok([{ name: "v1", sync }]));
      vi.mocked(commands.remoteTagPush).mockResolvedValue(ok(null));
    };

    it("marks a tag the remote lacks and pushes it from the commit menu", async () => {
      const user = userEvent.setup();
      withStates("missing");
      setup();
      const list = await screen.findByRole("listbox", { name: "Commits" });
      // Asked without a sign-in prompt.
      await waitFor(() =>
        expect(commands.remoteTagStates).toHaveBeenCalledWith(
          expect.any(String),
          "/repo",
          "origin",
          false,
          expect.anything(),
        ),
      );
      expect(await within(list).findByText(/Not on the remote yet/)).toBeInTheDocument();

      const menu = await openMenu(user, "Commit number 2");
      await user.click(within(menu).getByRole("menuitem", { name: "Push v1 to Remote" }));
      expect(commands.remoteTagPush).toHaveBeenCalledWith(
        expect.any(String),
        "/repo",
        "origin",
        ["v1"],
        false,
        expect.anything(),
      );
      expect(await screen.findByText("Pushed tag v1 to origin.")).toBeVisible();
    });

    it("asks before replacing a tag the remote has elsewhere", async () => {
      const user = userEvent.setup();
      withStates("differs");
      setup();
      const list = await screen.findByRole("listbox", { name: "Commits" });
      expect(await within(list).findByText(/points elsewhere/)).toBeInTheDocument();
      const menu = await openMenu(user, "Commit number 2");
      await user.click(within(menu).getByRole("menuitem", { name: "Replace v1 on Remote…" }));
      const dialog = await screen.findByRole("dialog", { name: "Replace tag v1 on origin?" });
      expect(commands.remoteTagPush).not.toHaveBeenCalled();
      await user.click(within(dialog).getByRole("button", { name: "Replace" }));
      expect(commands.remoteTagPush).toHaveBeenCalledWith(
        expect.any(String),
        "/repo",
        "origin",
        ["v1"],
        true,
        expect.anything(),
      );
    });

    it("offers no push for a tag the remote already has", async () => {
      const user = userEvent.setup();
      withStates("same");
      setup();
      await waitFor(() => expect(commands.remoteTagStates).toHaveBeenCalled());
      const menu = await openMenu(user, "Commit number 2");
      expect(within(menu).queryByRole("menuitem", { name: /to Remote|on Remote/ })).toBeNull();
    });

    it("lists tags beside the search and shows the history from one", async () => {
      const user = userEvent.setup();
      withStates("missing");
      const { container } = setup();
      await user.click(await screen.findByRole("button", { name: "Tags" }));
      const panel = await screen.findByRole("dialog", { name: "Tags" });
      expect(await axeViolations(container)).toEqual([]);
      expect(
        await within(panel).findByRole("button", { name: "Push 1 tag missing on origin" }),
      ).toBeVisible();
      await user.click(within(panel).getByRole("radio", { name: "Newest" }));
      expect(commands.tagList).toHaveBeenLastCalledWith("/repo", "newest");

      await user.click(within(panel).getByRole("button", { name: /^v1/ }));
      await waitFor(() =>
        expect(commands.historyList).toHaveBeenLastCalledWith(
          expect.any(String),
          "/repo",
          { ...DEFAULT_FILTER, scope: { kind: "ref", refname: "refs/tags/v1" } },
          0,
          100,
        ),
      );
    });

    it("checks again with a sign-in when the remote wanted one", async () => {
      const user = userEvent.setup();
      withStates("same");
      vi.mocked(commands.remoteTagStates)
        .mockResolvedValueOnce({
          status: "error",
          error: { kind: "authentication_failed", params: {}, detail: null },
        })
        .mockResolvedValueOnce(ok([{ name: "v1", sync: "same" }]));
      setup();
      await user.click(await screen.findByRole("button", { name: "Tags" }));
      const panel = await screen.findByRole("dialog", { name: "Tags" });
      expect(await within(panel).findByText(/Couldn't check the tags on origin/)).toBeVisible();
      await user.click(within(panel).getByRole("button", { name: "Check again" }));
      expect(commands.remoteTagStates).toHaveBeenLastCalledWith(
        expect.any(String),
        "/repo",
        "origin",
        true,
        expect.anything(),
      );
      await waitFor(() => expect(within(panel).queryByText(/Couldn't check/)).toBeNull());
    });

    it("hides the tag button without tags", async () => {
      vi.mocked(commands.tagList).mockResolvedValue(ok([]));
      setup();
      await screen.findByRole("listbox", { name: "Commits" });
      expect(screen.queryByRole("button", { name: "Tags" })).toBeNull();
    });
  });

  it("deletes a tag here, and on the remote when asked", async () => {
    const user = userEvent.setup();
    vi.mocked(commands.tagDelete).mockResolvedValue(ok(null));
    vi.mocked(commands.remoteTagDelete).mockResolvedValue(ok(null));
    setup();
    let menu = await openMenu(user, "Commit number 2");
    await user.click(within(menu).getByRole("menuitem", { name: "Delete Tag v1…" }));
    let dialog = await screen.findByRole("dialog", { name: "Delete tag v1?" });
    await user.click(within(dialog).getByRole("button", { name: "Delete Tag" }));
    expect(await screen.findByText("Deleted tag v1.")).toBeVisible();
    expect(commands.tagDelete).toHaveBeenLastCalledWith("/repo", "v1");
    expect(commands.remoteTagDelete).not.toHaveBeenCalled();

    menu = await openMenu(user, "Commit number 2");
    await user.click(within(menu).getByRole("menuitem", { name: "Delete Tag v1…" }));
    dialog = await screen.findByRole("dialog", { name: "Delete tag v1?" });
    await user.click(within(dialog).getByRole("checkbox", { name: /Also delete it on origin/ }));
    await user.click(within(dialog).getByRole("button", { name: "Delete Tag" }));
    expect(await screen.findByText("Deleted tag v1 here and on origin.")).toBeVisible();
    expect(commands.remoteTagDelete).toHaveBeenCalledWith(
      expect.any(String),
      "/repo",
      "origin",
      "v1",
      expect.anything(),
    );
  });

  it("doesn't offer the remote for a tag that was never pushed", async () => {
    const user = userEvent.setup();
    setup();
    vi.mocked(commands.statusGet).mockResolvedValue(
      ok({
        branch: { head: "main", oid: commits[0].oid, upstream: null, ahead: 0, behind: 0 },
        files: [],
        unpushedTags: ["v1"],
      }),
    );
    const menu = await openMenu(user, "Commit number 2");
    await user.click(within(menu).getByRole("menuitem", { name: "Delete Tag v1…" }));
    const dialog = await screen.findByRole("dialog", { name: "Delete tag v1?" });
    expect(within(dialog).getByText(/was never pushed/)).toBeVisible();
    expect(within(dialog).queryByRole("checkbox")).toBeNull();
  });

  it("draws the graph with uncommitted changes and stashes, but not for a search", async () => {
    const user = userEvent.setup();
    const stashed: HistoryMarkers["stashes"][number] = {
      oid: "s".repeat(40),
      base: commits[1].oid,
      name: "stash@{0}",
      branch: "main",
      message: "garam-auto-stash:main",
      auto: true,
      hasUntracked: false,
      createdAt: now,
    };
    const { container } = setup({ ...markers, stashes: [stashed] }, [
      { path: "a.txt", origPath: null, staged: null, unstaged: "modified", isSubmodule: false },
      { path: "b.txt", origPath: null, staged: "added", unstaged: null, isSubmodule: false },
    ]);
    const list = await screen.findByRole("listbox", { name: "Commits" });
    await within(list).findByText("Uncommitted changes (2 files)");
    await within(list).findByText(/Changes left on main/);
    const names = within(list)
      .getAllByRole("option")
      .map((o) => o.textContent);
    expect(names[0]).toMatch(/^Uncommitted changes/);
    expect(names[1]).toMatch(/^Add login screen/);
    expect(names[2]).toMatch(/^Changes left on main when switching branches/);
    expect(names[3]).toMatch(/^Commit number 2/);
    expect(list.querySelectorAll("svg circle, svg rect").length).toBeGreaterThanOrEqual(5);
    expect(await axeViolations(container)).toEqual([]);

    await user.click(within(list).getByText("Uncommitted changes (2 files)"));
    expect(await screen.findByRole("button", { name: "Show in Changes" })).toBeVisible();

    // A stash shows its files, untracked ones too, and the ways to restore it.
    vi.mocked(commands.stashFiles).mockResolvedValue(
      ok([
        { path: "a.txt", origPath: null, kind: "modified" },
        { path: "new.txt", origPath: null, kind: "untracked" },
      ]),
    );
    vi.mocked(commands.stashFileDiff).mockResolvedValue(
      ok({ type: "text", hunks: [], selectable: false }),
    );
    vi.mocked(commands.stashApply).mockResolvedValue(ok("applied"));
    await user.click(within(list).getByText(/Changes left on main/));
    expect(
      await screen.findByRole("heading", { name: "Changes left on main when switching branches" }),
    ).toBeVisible();
    expect(screen.getByText("Garam stashed these when you switched branches.")).toBeVisible();
    expect(await screen.findByRole("button", { name: /new\.txt/ })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Restore" }));
    expect(commands.stashApply).toHaveBeenCalledWith("/repo", stashed.oid, true);

    vi.mocked(commands.historyList).mockResolvedValue(ok([commits[2]]));
    await user.type(screen.getByRole("searchbox"), "number");
    await waitFor(() => expect(within(list).getAllByRole("option")).toHaveLength(1));
    expect(list.querySelector("svg")).toBeNull();
  });

  it("shows commit prefixes as badges and reads the message closely", async () => {
    const user = userEvent.setup();
    setup();
    const message = commit(4, { summary: "feat(ui)!: New sidebar" });
    vi.mocked(commands.historyList).mockResolvedValue(ok([message, ...commits]));
    vi.mocked(commands.commitDetail).mockResolvedValue(
      ok({
        ...detail(message),
        body: "Closes #42.\n\nCo-authored-by: Bo Kim <bo@example.com>",
      }),
    );
    vi.mocked(commands.commitSignature).mockResolvedValue(
      ok({ status: "good", signer: "김가람 <garam@example.com>", key: "ABC" }),
    );
    // A fresh query for the new list.
    useHistoryFilters.getState().update("/repo", { firstParent: true });

    const list = await screen.findByRole("listbox", { name: "Commits" });
    await user.click(await within(list).findByText("New sidebar"));
    expect(within(list).getByText("feat(ui)!")).toBeVisible();

    const heading = await screen.findByRole("heading", { name: "feat(ui)! New sidebar" });
    expect(heading).toBeVisible();
    expect(screen.getByText("Breaking change")).toBeVisible();
    expect(screen.getByText("Co-authored by Bo Kim")).toBeVisible();
    expect(screen.queryByText(/Co-authored-by:/)).toBeNull();
    expect(await screen.findByText("Verified signature")).toBeVisible();

    await user.click(screen.getByRole("link", { name: "#42" }));
    expect(openUrl).toHaveBeenCalledWith("https://github.com/garam/app/issues/42");
    await user.click(screen.getByRole("button", { name: "Open on GitHub" }));
    expect(openUrl).toHaveBeenCalledWith(`https://github.com/garam/app/commit/${message.oid}`);
  });

  it("doesn't link to an unpushed commit on the remote", async () => {
    setup();
    await screen.findByRole("heading", { name: "Add login screen" });
    // The detail knows the commit isn't pushed, and the remote is known.
    await waitFor(() => expect(commands.remoteInfo).toHaveBeenCalled());
    await waitFor(() => expect(screen.getAllByText("Not pushed yet").length).toBeGreaterThan(1));
    expect(screen.queryByRole("button", { name: "Open on GitHub" })).toBeNull();
  });

  it("can ignore whitespace and compares images", async () => {
    const user = userEvent.setup();
    setup();
    await screen.findByText("contents of src/login.tsx");
    await user.click(screen.getByRole("checkbox", { name: "Ignore whitespace" }));
    await waitFor(() =>
      expect(commands.commitFileDiff).toHaveBeenLastCalledWith(
        "/repo",
        commits[0].oid,
        expect.objectContaining({ path: "src/login.tsx" }),
        true,
      ),
    );

    vi.mocked(commands.commitDetail).mockResolvedValue(
      ok({
        ...detail(commits[1]),
        files: [{ path: "logo.png", origPath: null, kind: "modified" }],
      }),
    );
    vi.mocked(commands.commitImages).mockResolvedValue(
      ok({ before: "data:image/png;base64,AA==", after: null }),
    );
    await user.click(await screen.findByText("Commit number 2"));
    expect(await screen.findByRole("img", { name: "Before: logo.png" })).toBeVisible();
    expect(screen.queryByRole("checkbox", { name: "Ignore whitespace" })).toBeNull();
  });

  it("draws only the visible files of a commit that changes 100k", async () => {
    const user = userEvent.setup();
    setup();
    const files = Array.from({ length: 100_000 }, (_, i) => ({
      path: `src/f${i}.txt`,
      origPath: null,
      kind: "added" as const,
    }));
    vi.mocked(commands.commitDetail).mockResolvedValue(ok({ ...detail(commits[1]), files }));
    await user.click(await screen.findByText("Commit number 2"));

    const list = await screen.findByRole("navigation", { name: /^100,?000 changed files$/ });
    const rows = within(list).getAllByRole("button");
    expect(rows[0]).toHaveTextContent("src/f0.txt");
    expect(rows.length).toBeLessThan(100);
  });

  it("copies and saves a commit as a patch", async () => {
    const user = userEvent.setup();
    vi.mocked(commands.commitPatch).mockResolvedValue(ok("From abc\nSubject: [PATCH] x\n"));
    vi.mocked(commands.commitPatchSave).mockResolvedValue(ok(null));
    vi.mocked(save).mockResolvedValue("/tmp/2222222.patch");
    setup();

    let menu = await openMenu(user, "Commit number 2");
    await user.click(within(menu).getByRole("menuitem", { name: "Copy as Patch" }));
    expect(await screen.findByText("Copied “Commit number 2” as a patch.")).toBeVisible();
    expect(await navigator.clipboard.readText()).toBe("From abc\nSubject: [PATCH] x\n");

    menu = await openMenu(user, "Commit number 2");
    await user.click(within(menu).getByRole("menuitem", { name: "Save as Patch…" }));
    expect(await screen.findByText("Saved the patch.")).toBeVisible();
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ defaultPath: "2222222.patch" }));
    expect(commands.commitPatchSave).toHaveBeenCalledWith(
      "/repo",
      commits[1].oid,
      "/tmp/2222222.patch",
    );
  });

  const comparison = {
    base: commits[2].oid,
    target: commits[0].oid,
    from: commits[2].oid,
    ahead: 2,
    behind: 0,
    commits: [commits[0], commits[1]],
    files: [{ path: "src/login.tsx", origPath: null, kind: "added" as const }],
  };

  const withParents = [
    commit(1, { summary: "Add login screen", parents: ["2".repeat(40)] }),
    commit(2, { parents: ["3".repeat(40)] }),
    commit(3, { parents: ["0".repeat(40)] }),
  ];

  it("selects several commits with Cmd-click and Shift-click", async () => {
    const user = userEvent.setup();
    vi.mocked(commands.compareGet).mockResolvedValue(ok(comparison));
    vi.mocked(commands.compareFileDiff).mockResolvedValue(
      ok({ type: "text", selectable: false, hunks: [] }),
    );
    setup();
    vi.mocked(commands.historyList).mockResolvedValue(ok(withParents));
    useHistoryFilters.getState().update("/repo", { firstParent: true });
    await screen.findByRole("heading", { name: "Add login screen" });
    const list = screen.getByRole("listbox", { name: "Commits" });
    expect(list).toHaveAttribute("aria-multiselectable", "true");

    const modifier = currentPlatform() === "macos" ? "Meta" : "Control";
    await user.keyboard(`{${modifier}>}`);
    await user.click(within(list).getByText("Commit number 3"));
    await user.keyboard(`{/${modifier}}`);
    expect(await screen.findByRole("heading", { name: "2 commits selected" })).toBeVisible();
    const selected = () =>
      within(list)
        .getAllByRole("option")
        .filter((o) => o.getAttribute("aria-selected") === "true").length;
    expect(selected()).toBe(2);
    // Their changes together: from before the oldest to the newest.
    expect(commands.compareGet).toHaveBeenCalledWith(
      "/repo",
      "0".repeat(40),
      withParents[0].oid,
      "two_dot",
    );
    expect(screen.getByRole("button", { name: /src\/login\.tsx/ })).toBeVisible();

    await user.keyboard("{Shift>}");
    await user.click(within(list).getByText("Commit number 2"));
    await user.keyboard("{/Shift}");
    expect(await screen.findByRole("heading", { name: "2 commits selected" })).toBeVisible();

    // A plain click goes back to one commit.
    await user.click(within(list).getByText("Commit number 2"));
    expect(await screen.findByRole("heading", { name: "Commit number 2" })).toBeVisible();
    expect(selected()).toBe(1);

    // Shift+arrow extends from the keyboard.
    list.focus();
    await user.keyboard("{Shift>}{ArrowDown}{/Shift}");
    expect(await screen.findByRole("heading", { name: "2 commits selected" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Clear selection" }));
    expect(await screen.findByRole("heading", { name: "Add login screen" })).toBeVisible();
  });

  it("still compares one commit with another from the menu", async () => {
    const user = userEvent.setup();
    vi.mocked(commands.compareGet).mockResolvedValue(ok(comparison));
    vi.mocked(commands.compareFileDiff).mockResolvedValue(
      ok({ type: "text", selectable: false, hunks: [] }),
    );
    setup();
    await screen.findByRole("heading", { name: "Add login screen" });
    const menu = await openMenu(user, "Commit number 3");
    await user.click(within(menu).getByRole("menuitem", { name: "Compare with Selected Commit" }));
    expect(commands.compareGet).toHaveBeenLastCalledWith(
      "/repo",
      commits[2].oid,
      commits[0].oid,
      "two_dot",
    );
    expect(await screen.findByRole("heading", { name: "3333333 ↔ 1111111" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Close comparison" }));
    expect(await screen.findByRole("heading", { name: "Add login screen" })).toBeVisible();
  });

  it("reverts and squashes several commits, and cherry-picks incoming ones", async () => {
    const user = userEvent.setup();
    vi.mocked(commands.compareGet).mockResolvedValue(ok(comparison));
    vi.mocked(commands.compareFileDiff).mockResolvedValue(
      ok({ type: "text", selectable: false, hunks: [] }),
    );
    vi.mocked(commands.commitRevert).mockResolvedValue(ok(null));
    vi.mocked(commands.commitSquash).mockResolvedValue(ok("9".repeat(40)));
    vi.mocked(commands.commitCherryPick).mockResolvedValue(ok({ picked: 1, skipped: 1 }));
    const incoming = [
      commit(8, { summary: "Teammate's second", parents: ["7".repeat(40)] }),
      commit(7, { summary: "Teammate's first" }),
    ];
    // Commit 1 is pushed here, so squashing it warns.
    setup({ ...markers, incoming, unpushed: [] });
    vi.mocked(commands.historyList).mockResolvedValue(ok(withParents));
    useHistoryFilters.getState().update("/repo", { firstParent: true });
    await screen.findByRole("heading", { name: "Add login screen" });
    const list = screen.getByRole("listbox", { name: "Commits" });

    await user.keyboard("{Shift>}");
    await user.click(within(list).getByText("Commit number 2"));
    await user.keyboard("{/Shift}");
    let menu = await openMenu(user, "Commit number 2");
    expect(within(menu).queryByRole("menuitem", { name: /onto Current Branch/ })).toBeNull();
    await user.click(within(menu).getByRole("menuitem", { name: "Revert 2 Commits" }));
    expect(commands.commitRevert).toHaveBeenCalledWith("/repo", [
      withParents[0].oid,
      withParents[1].oid,
    ]);
    expect(await screen.findByText("Reverted 2 commits with new commits.")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Squash…" }));
    const dialog = await screen.findByRole("dialog", { name: "Squash 2 Commits" });
    expect(within(dialog).getByRole("textbox", { name: "Summary" })).toHaveValue("Commit number 2");
    expect(within(dialog).getByRole("textbox", { name: "Description" })).toHaveValue(
      "- Add login screen",
    );
    expect(within(dialog).getByText(/you'll need to force push/)).toBeVisible();
    expect(await axeViolations(dialog)).toEqual([]);
    await user.click(within(dialog).getByRole("button", { name: "Squash" }));
    expect(commands.commitSquash).toHaveBeenCalledWith(
      "/repo",
      [withParents[0].oid, withParents[1].oid],
      "Commit number 2\n\n- Add login screen",
    );
    expect(await screen.findByText("Squashed 2 commits into one.")).toBeVisible();

    // Incoming commits (listed without a filter) are applied oldest first.
    act(() => useHistoryFilters.getState().reset("/repo"));
    await user.click(await within(list).findByText("Teammate's second"));
    await user.keyboard("{Shift>}");
    await user.click(within(list).getByText("Teammate's first"));
    await user.keyboard("{/Shift}");
    menu = await openMenu(user, "Teammate's first");
    expect(within(menu).queryByRole("menuitem", { name: /Squash/ })).toBeNull();
    await user.click(
      within(menu).getByRole("menuitem", { name: "Cherry-pick 2 Commits onto Current Branch" }),
    );
    expect(commands.commitCherryPick).toHaveBeenCalledWith("/repo", [
      incoming[1].oid,
      incoming[0].oid,
    ]);
    expect(
      await screen.findByText("Cherry-picked 1 commit. Skipped 1 already here."),
    ).toBeVisible();
  });

  it("compares any two branches, either way and in both modes", async () => {
    const user = userEvent.setup();
    vi.mocked(commands.compareGet).mockResolvedValue(ok(comparison));
    vi.mocked(commands.compareFileDiff).mockResolvedValue(
      ok({ type: "text", selectable: false, hunks: [] }),
    );
    setup();
    await screen.findByRole("heading", { name: "Add login screen" });
    useHistoryDialog.setState({ dialog: { kind: "compareBranch" } });

    const dialog = await screen.findByRole("dialog", { name: "Compare Branches" });
    const base = await within(dialog).findByRole("combobox", { name: "Base" });
    const target = within(dialog).getByRole("combobox", { name: "Target" });
    // The current branch is the base; the first other branch the target.
    expect(base).toHaveTextContent("main");
    expect(target).toHaveTextContent("origin/main");
    expect(within(dialog).getByRole("radio", { name: "Changes since split" })).toBeChecked();
    expect(await axeViolations(dialog)).toEqual([]);

    // The same branch on both sides can't be compared.
    await user.click(target);
    await user.click(await screen.findByRole("option", { name: "main" }));
    expect(within(dialog).getByText(/Base and target are the same/)).toBeVisible();
    expect(within(dialog).getByRole("button", { name: "Compare" })).toBeDisabled();
    await user.click(base);
    await user.click(await screen.findByRole("option", { name: "origin/main" }));

    await user.click(within(dialog).getByRole("radio", { name: "Difference" }));
    await user.click(within(dialog).getByRole("button", { name: "Compare" }));
    expect(commands.compareGet).toHaveBeenLastCalledWith(
      "/repo",
      "refs/remotes/origin/main",
      "refs/heads/main",
      "two_dot",
    );
    expect(await screen.findByRole("heading", { name: "origin/main ↔ main" })).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Swap base and target" }));
    expect(commands.compareGet).toHaveBeenLastCalledWith(
      "/repo",
      "refs/heads/main",
      "refs/remotes/origin/main",
      "two_dot",
    );
    expect(await screen.findByRole("heading", { name: "main ↔ origin/main" })).toBeVisible();

    await user.click(screen.getByRole("radio", { name: "Changes since split" }));
    expect(commands.compareGet).toHaveBeenLastCalledWith(
      "/repo",
      "refs/heads/main",
      "refs/remotes/origin/main",
      "three_dot",
    );
    expect(
      await screen.findByText("What origin/main changed since it split from main."),
    ).toBeVisible();
  });

  it("lists lost commits to view or bring back", async () => {
    const user = userEvent.setup();
    const lost = {
      ...commit(7, { summary: "fix: work I reset away" }),
      action: "reset: moving to HEAD~1",
      visitedAt: now - 60,
    };
    vi.mocked(commands.lostCommits).mockResolvedValue(ok([lost]));
    setup();
    vi.mocked(commands.commitDetail).mockImplementation(async (_repo, oid) =>
      ok(detail([lost, ...commits].find((c) => c.oid === oid)!)),
    );
    await screen.findByRole("heading", { name: "Add login screen" });
    useHistoryDialog.setState({ dialog: { kind: "recover" } });

    let dialog = await screen.findByRole("dialog", { name: "Recover Lost Commits" });
    const item = await within(dialog).findByText(/reset: moving to HEAD~1/);
    expect(item).toHaveTextContent("7777777");
    expect(await axeViolations(dialog)).toEqual([]);
    await user.click(within(dialog).getByRole("button", { name: "View" }));
    expect(await screen.findByRole("heading", { name: "fix work I reset away" })).toBeVisible();
    expect(
      screen.getByText("No branch holds this commit. Create a branch to keep it."),
    ).toBeVisible();

    useHistoryDialog.setState({ dialog: { kind: "recover" } });
    dialog = await screen.findByRole("dialog", { name: "Recover Lost Commits" });
    await user.click(await within(dialog).findByRole("button", { name: "Create Branch…" }));
    expect(useBranchDialog.getState().dialog).toEqual({ kind: "create", from: lost });
  });

  it("says when nothing is lost", async () => {
    vi.mocked(commands.lostCommits).mockResolvedValue(ok([]));
    setup();
    await screen.findByRole("heading", { name: "Add login screen" });
    useHistoryDialog.setState({ dialog: { kind: "recover" } });
    expect(await screen.findByText("No lost commits.")).toBeVisible();
  });

  it("cherry-picks commits from here onto another branch", async () => {
    const user = userEvent.setup();
    vi.mocked(commands.commitCherryPickOnto).mockResolvedValue(ok({ picked: 2, skipped: 0 }));
    setup();
    await screen.findByRole("heading", { name: "Add login screen" });
    vi.mocked(commands.branchList).mockResolvedValue(
      ok([
        {
          name: "main",
          kind: "local",
          remote: null,
          oid: commits[0].oid,
          isHead: true,
          upstream: null,
          upstreamGone: false,
          ahead: 0,
          behind: 0,
          committedAt: now,
          subject: "",
        },
        {
          name: "release",
          kind: "local",
          remote: null,
          oid: commits[2].oid,
          isHead: false,
          upstream: null,
          upstreamGone: false,
          ahead: 0,
          behind: 0,
          committedAt: now,
          subject: "",
        },
      ]),
    );
    const list = screen.getByRole("listbox", { name: "Commits" });
    await user.keyboard("{Shift>}");
    await user.click(within(list).getByText("Commit number 2"));
    await user.keyboard("{/Shift}");
    const menu = await openMenu(user, "Add login screen");
    await user.click(
      within(menu).getByRole("menuitem", { name: "Cherry-pick 2 Commits onto Another Branch…" }),
    );

    const dialog = await screen.findByRole("dialog", {
      name: "Cherry-pick 2 Commits onto Another Branch",
    });
    expect(
      await within(dialog).findByRole("combobox", { name: "Target branch" }),
    ).toHaveTextContent("release");
    await user.click(within(dialog).getByRole("button", { name: "Cherry-pick" }));
    expect(commands.commitCherryPickOnto).toHaveBeenCalledWith("/repo", "release", [
      commits[1].oid,
      commits[0].oid,
    ]);
    expect(
      await screen.findByText("Switched to release and cherry-picked 2 commits."),
    ).toBeVisible();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  /** A spot to drop dragged commits on, as the branch list provides. */
  function dropSpot(branch: string) {
    const spot = document.createElement("div");
    spot.setAttribute("data-drop-branch", branch);
    document.body.append(spot);
    return spot;
  }

  it("drags commits onto a branch to cherry-pick them there", async () => {
    const user = userEvent.setup();
    vi.mocked(commands.commitCherryPickOnto).mockResolvedValue(ok({ picked: 2, skipped: 0 }));
    setup();
    await screen.findByRole("heading", { name: "Add login screen" });
    const list = screen.getByRole("listbox", { name: "Commits" });
    await user.keyboard("{Shift>}");
    await user.click(within(list).getByText("Commit number 2"));
    await user.keyboard("{/Shift}");

    // Pressing one of the selected commits keeps the selection for the drag.
    const release = dropSpot("release");
    fireEvent.mouseDown(within(list).getByText("Add login screen"), {
      button: 0,
      clientX: 10,
      clientY: 10,
    });
    fireEvent.mouseMove(release, { clientX: 300, clientY: 40 });
    expect(await screen.findByText("2 commits")).toBeVisible();
    expect(screen.getByText("→ Cherry-pick onto release")).toBeVisible();
    fireEvent.mouseUp(release);

    await waitFor(() =>
      expect(commands.commitCherryPickOnto).toHaveBeenCalledWith("/repo", "release", [
        commits[1].oid,
        commits[0].oid,
      ]),
    );
    expect(
      await screen.findByText("Switched to release and cherry-picked 2 commits."),
    ).toBeVisible();
    expect(screen.queryByText("2 commits")).toBeNull();
    release.remove();
  });

  it("cancels a drag with Escape and says when commits are already here", async () => {
    setup();
    await screen.findByRole("heading", { name: "Add login screen" });
    const list = screen.getByRole("listbox", { name: "Commits" });
    const main = dropSpot("main");

    const row = within(list).getByText("Commit number 2");
    fireEvent.mouseDown(row, { button: 0, clientX: 10, clientY: 10 });
    fireEvent.mouseMove(main, { clientX: 300, clientY: 40 });
    expect(await screen.findByText("→ Cherry-pick onto main")).toBeVisible();
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.mouseUp(main);
    expect(screen.queryByText("→ Cherry-pick onto main")).toBeNull();
    expect(commands.commitCherryPick).not.toHaveBeenCalled();

    // A commit from the current branch onto the current branch.
    fireEvent.mouseDown(row, { button: 0, clientX: 10, clientY: 10 });
    fireEvent.mouseMove(main, { clientX: 300, clientY: 40 });
    fireEvent.mouseUp(main);
    expect(
      await screen.findByText("Those commits are already on the current branch."),
    ).toBeVisible();
    expect(commands.commitCherryPick).not.toHaveBeenCalled();
    main.remove();
  });

  /** Drags the row with `text` onto the top half of the row with `onto`. */
  function dragRow(list: HTMLElement, text: string, onto: string) {
    const row = within(list).getByText(text);
    fireEvent.mouseDown(row, { button: 0, clientX: 10, clientY: 10 });
    const target = within(list).getByText(onto);
    // jsdom rows have no size, so y = 0 is the top half.
    fireEvent.mouseMove(target, { clientX: 10, clientY: 0 });
    return target;
  }

  it("drags a commit to a new place in the list to reorder", async () => {
    vi.mocked(commands.commitReorder).mockResolvedValue(ok(null));
    setup({ ...markers, unpushed: commits.map((c) => c.oid) });
    await screen.findByRole("heading", { name: "Add login screen" });
    const list = screen.getByRole("listbox", { name: "Commits" });

    const target = dragRow(list, "Commit number 3", "Add login screen");
    expect(await screen.findByText("→ Move here")).toBeVisible();
    fireEvent.mouseUp(target);
    await waitFor(() =>
      expect(commands.commitReorder).toHaveBeenCalledWith("/repo", [
        commits[2].oid,
        commits[0].oid,
        commits[1].oid,
      ]),
    );
    expect(await screen.findByText("Reordered the commits.")).toBeVisible();

    // Dropping where it already is does nothing.
    vi.mocked(commands.commitReorder).mockClear();
    fireEvent.mouseUp(dragRow(list, "Commit number 2", "Commit number 2"));
    expect(commands.commitReorder).not.toHaveBeenCalled();
  });

  it("asks before reordering pushed commits", async () => {
    const user = userEvent.setup();
    vi.mocked(commands.commitReorder).mockResolvedValue(ok(null));
    setup();
    await screen.findByRole("heading", { name: "Add login screen" });
    const list = screen.getByRole("listbox", { name: "Commits" });

    fireEvent.mouseUp(dragRow(list, "Commit number 2", "Add login screen"));
    const dialog = await screen.findByRole("dialog", { name: "Reorder Commits" });
    expect(within(dialog).getByText(/you'll need to force push/)).toBeVisible();
    expect(commands.commitReorder).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "Reorder" }));
    expect(commands.commitReorder).toHaveBeenCalledWith("/repo", [commits[1].oid, commits[0].oid]);
  });

  /** Gives jsdom a real row height so edges and centers are distinct. */
  function squashDrag(list: HTMLElement, from: string, onto: string) {
    const source = within(list).getByText(from);
    const target = within(list).getByText(onto);
    const row = target.closest<HTMLElement>("[data-row-index]")!;
    vi.spyOn(row, "getBoundingClientRect").mockReturnValue({
      top: 100,
      height: 48,
      bottom: 148,
      left: 0,
      right: 300,
      width: 300,
      x: 0,
      y: 100,
      toJSON: () => ({}),
    });
    fireEvent.mouseDown(source, { button: 0, clientX: 10, clientY: 10 });
    fireEvent.mouseMove(target, { clientX: 10, clientY: 124 });
    return { target, row };
  }

  it("drags onto a nonadjacent commit to confirm a squash into that target", async () => {
    const user = userEvent.setup();
    vi.mocked(commands.commitSquashOnto).mockResolvedValue(ok(null));
    setup({ ...markers, unpushed: withParents.map((c) => c.oid) });
    vi.mocked(commands.historyList).mockResolvedValue(ok(withParents));
    await screen.findByRole("heading", { name: "Add login screen" });
    const list = screen.getByRole("listbox", { name: "Commits" });
    const { target, row } = squashDrag(list, "Add login screen", "Commit number 3");
    expect(await screen.findByText("→ Squash here")).toBeVisible();
    expect(row).toHaveAttribute("data-squash-target", "true");
    expect(screen.queryByText("→ Move here")).toBeNull();
    fireEvent.mouseUp(target, { clientX: 10, clientY: 124 });
    const dialog = await screen.findByRole("dialog", { name: "Squash 2 Commits" });
    expect(within(dialog).getByRole("textbox", { name: "Summary" })).toHaveValue("Commit number 3");
    expect(within(dialog).queryByText(/force push/)).toBeNull();
    expect(commands.commitSquashOnto).not.toHaveBeenCalled();
    expect(commands.commitReorder).not.toHaveBeenCalled();
    expect(await axeViolations(dialog)).toEqual([]);
    await user.click(within(dialog).getByRole("button", { name: "Squash" }));
    expect(commands.commitSquashOnto).toHaveBeenCalledWith(
      "/repo",
      [withParents[0].oid],
      withParents[2].oid,
      withParents[0].oid,
      "main",
      "Commit number 3\n\n- Add login screen",
    );
    expect(await screen.findByText("Squashed 2 commits into one.")).toBeVisible();
  });

  it("keeps the newer target's message and warns for rewritten pushed commits", async () => {
    const user = userEvent.setup();
    // Only the intervening commit is marked pushed: it too gets rewritten.
    setup({ ...markers, unpushed: [withParents[0].oid, withParents[2].oid] });
    vi.mocked(commands.historyList).mockResolvedValue(ok(withParents));
    await screen.findByRole("heading", { name: "Add login screen" });
    const list = screen.getByRole("listbox", { name: "Commits" });
    const { target } = squashDrag(list, "Commit number 3", "Add login screen");
    fireEvent.mouseUp(target, { clientY: 124 });
    const dialog = await screen.findByRole("dialog", { name: "Squash 2 Commits" });
    expect(within(dialog).getByRole("textbox", { name: "Summary" })).toHaveValue(
      "Add login screen",
    );
    expect(within(dialog).getByText(/you'll need to force push/)).toBeVisible();
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(commands.commitSquashOnto).not.toHaveBeenCalled();
    expect(commands.commitReorder).not.toHaveBeenCalled();
  });

  it("squashes all dragged selected commits and excludes a selected target", async () => {
    const user = userEvent.setup();
    setup({ ...markers, unpushed: withParents.map((c) => c.oid) });
    vi.mocked(commands.historyList).mockResolvedValue(ok(withParents));
    await screen.findByRole("heading", { name: "Add login screen" });
    const list = screen.getByRole("listbox", { name: "Commits" });
    await user.keyboard("{Shift>}");
    await user.click(within(list).getByText("Commit number 2"));
    await user.keyboard("{/Shift}");
    const { target } = squashDrag(list, "Add login screen", "Commit number 3");
    fireEvent.mouseUp(target, { clientY: 124 });
    const dialog = await screen.findByRole("dialog", { name: "Squash 3 Commits" });
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    const selected = squashDrag(list, "Add login screen", "Commit number 2");
    expect(screen.queryByText("→ Squash here")).toBeNull();
    fireEvent.mouseUp(selected.target, { clientY: 124 });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(commands.commitReorder).not.toHaveBeenCalled();
  });

  it("cancels a squash drag and never uses the previous destination on release", async () => {
    setup({ ...markers, unpushed: withParents.map((c) => c.oid) });
    vi.mocked(commands.historyList).mockResolvedValue(ok(withParents));
    await screen.findByRole("heading", { name: "Add login screen" });
    const list = screen.getByRole("listbox", { name: "Commits" });
    let drag = squashDrag(list, "Add login screen", "Commit number 3");
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.mouseUp(drag.target, { clientY: 124 });
    expect(screen.queryByRole("dialog")).toBeNull();
    squashDrag(list, "Add login screen", "Commit number 3");
    fireEvent.mouseUp(document.body, { clientY: 124 });
    expect(screen.queryByRole("dialog")).toBeNull();
    drag = squashDrag(list, "Add login screen", "Commit number 3");
    fireEvent.blur(window);
    fireEvent.mouseUp(drag.target, { clientY: 124 });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(commands.commitSquashOnto).not.toHaveBeenCalled();
    expect(commands.commitReorder).not.toHaveBeenCalled();
  });

  it("does not offer squash targets across a merge or in filtered history", async () => {
    setup();
    vi.mocked(commands.historyList).mockResolvedValue(
      ok([
        withParents[0],
        { ...withParents[1], parents: [withParents[2].oid, "f".repeat(40)] },
        withParents[2],
      ]),
    );
    await screen.findByRole("heading", { name: "Add login screen" });
    const list = screen.getByRole("listbox", { name: "Commits" });
    const { target } = squashDrag(list, "Add login screen", "Commit number 3");
    expect(screen.queryByText("→ Squash here")).toBeNull();
    fireEvent.mouseUp(target, { clientY: 124 });
    expect(screen.queryByRole("dialog")).toBeNull();
    act(() => useHistoryFilters.getState().update("/repo", { path: "one.txt" }));
    await waitFor(() => expect(commands.historyPreparePaths).toHaveBeenCalled());
    const filtered = squashDrag(list, "Add login screen", "Commit number 3");
    fireEvent.mouseUp(filtered.target, { clientY: 124 });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens squash undo from the current commit menu after reopening history", async () => {
    const user = userEvent.setup();
    const { client } = setup();
    await screen.findByRole("heading", { name: "Add login screen" });
    act(() =>
      client.setQueryData(squashUndoKey("/repo"), {
        id: "a".repeat(40),
        branch: "main",
        before: commits[2].oid,
        after: commits[0].oid,
        count: 2,
        available: true,
        contentChanged: false,
      }),
    );
    const menu = await openMenu(user, "Add login screen");
    await user.click(within(menu).getByRole("menuitem", { name: "Undo Squash of 2 Commits…" }));
    expect(await screen.findByRole("dialog", { name: "Undo Squash of 2 Commits" })).toBeVisible();
    expect(commands.squashUndo).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
  });

  it("explains an empty history", async () => {
    setup();
    vi.mocked(commands.historyList).mockResolvedValue(ok([]));
    vi.mocked(commands.statusGet).mockResolvedValue(
      ok({
        branch: { head: "main", oid: null, upstream: null, ahead: 0, behind: 0 },
        files: [],
        unpushedTags: [],
      }),
    );
    expect(await screen.findByText("No commits yet.")).toBeVisible();
  });
});

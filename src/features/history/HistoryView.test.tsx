import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { commands, type CommitDetail, type CommitSummary, type HistoryMarkers } from "../../ipc";
import { axeViolations } from "../../test/axe";
import { renderWithQuery } from "../../test/renderWithQuery";
import { useBranchDialog } from "../branches/branchDialogStore";
import { Notifications } from "../notify/Notifications";
import { useNotify } from "../notify/notifyStore";
import { HistoryView } from "./HistoryView";

vi.mock("../../ipc/bindings", () => ({
  commands: {
    statusGet: vi.fn(),
    historyList: vi.fn(),
    historyMarkers: vi.fn(),
    commitDetail: vi.fn(),
    commitFileDiff: vi.fn(),
    commitRevert: vi.fn(),
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
  });

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
    expect(commands.historyList).toHaveBeenCalledWith("/repo", 0, 100);
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

  it("explains an empty history", async () => {
    setup();
    vi.mocked(commands.historyList).mockResolvedValue(ok([]));
    vi.mocked(commands.statusGet).mockResolvedValue(
      ok({ branch: { head: "main", oid: null, upstream: null, ahead: 0, behind: 0 }, files: [] }),
    );
    expect(await screen.findByText("No commits yet.")).toBeVisible();
  });
});

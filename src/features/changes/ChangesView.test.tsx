import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { commands, type FileChange, type RepoStatus } from "../../ipc";
import { renderWithQuery } from "../../test/renderWithQuery";
import { ChangesView } from "./ChangesView";

vi.mock("../../ipc/bindings", () => ({
  commands: {
    statusGet: vi.fn(),
    diffGet: vi.fn(),
    diffImages: vi.fn(),
    changesStage: vi.fn(),
    changesUnstage: vi.fn(),
    changesStageLines: vi.fn(),
    changesDiscard: vi.fn(),
    commitCreate: vi.fn(),
    commitHead: vi.fn(),
    identityGet: vi.fn(),
    identitySet: vi.fn(),
    externalReveal: vi.fn(),
  },
}));

const ok = <T,>(data: T) => ({ status: "ok" as const, data });

const change = (path: string, staged: FileChange["staged"], unstaged: FileChange["unstaged"]) => ({
  path,
  origPath: null,
  staged,
  unstaged,
  isSubmodule: false,
});

function setup(files: FileChange[]) {
  const status: RepoStatus = {
    branch: { head: "main", oid: "abc", upstream: null, ahead: 0, behind: 0 },
    files,
  };
  vi.mocked(commands.statusGet).mockResolvedValue(ok(status));
  vi.mocked(commands.diffGet).mockResolvedValue(
    ok({
      type: "text",
      hunks: [
        {
          oldStart: 1,
          oldLines: 1,
          newStart: 1,
          newLines: 1,
          section: "",
          lines: [
            {
              kind: "deleted",
              text: "old line",
              oldLine: 1,
              newLine: null,
              noNewline: false,
              staged: false,
            },
            {
              kind: "added",
              text: "new line",
              oldLine: null,
              newLine: 1,
              noNewline: false,
              staged: false,
            },
            {
              kind: "added",
              text: "another line",
              oldLine: null,
              newLine: 2,
              noNewline: false,
              staged: true,
            },
          ],
        },
      ],
      selectable: true,
    }),
  );
  vi.mocked(commands.identityGet).mockResolvedValue(
    ok({ name: "Garam", email: "garam@example.com" }),
  );
  vi.mocked(commands.commitHead).mockResolvedValue(
    ok({ oid: "abc", summary: "Previous summary", body: "Previous body" }),
  );
  for (const fn of [
    commands.changesStage,
    commands.changesUnstage,
    commands.changesDiscard,
    commands.changesStageLines,
  ]) {
    vi.mocked(fn).mockResolvedValue(ok(null));
  }
  vi.mocked(commands.commitCreate).mockResolvedValue(ok("def"));
  return renderWithQuery(<ChangesView repo="/repo" />);
}

describe("ChangesView", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lists files and shows the first file's diff", async () => {
    setup([change("src/app.ts", null, "modified"), change("새 파일.md", null, "untracked")]);
    expect(await screen.findByText("2 changed files")).toBeVisible();
    expect(screen.getByRole("option", { name: /app\.ts/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(await screen.findByText("new line")).toBeVisible();
    expect(screen.getByText("old line")).toBeVisible();
  });

  it("stages and unstages with the checkboxes", async () => {
    const user = userEvent.setup();
    setup([change("a.txt", null, "modified"), change("b.txt", "modified", null)]);

    await user.click(await screen.findByRole("checkbox", { name: "Include a.txt in the commit" }));
    expect(commands.changesStage).toHaveBeenCalledWith("/repo", [
      expect.objectContaining({ path: "a.txt" }),
    ]);

    await user.click(screen.getByRole("checkbox", { name: "Include b.txt in the commit" }));
    expect(commands.changesUnstage).toHaveBeenCalledWith("/repo", [
      expect.objectContaining({ path: "b.txt" }),
    ]);

    // Mixed selection: "include all" stages everything.
    await user.click(screen.getByRole("checkbox", { name: "Include all files in the commit" }));
    expect(commands.changesStage).toHaveBeenLastCalledWith("/repo", [
      expect.objectContaining({ path: "a.txt" }),
      expect.objectContaining({ path: "b.txt" }),
    ]);
  });

  it("asks before discarding everything", async () => {
    const user = userEvent.setup();
    setup([change("a.txt", null, "modified")]);
    await user.click(await screen.findByRole("button", { name: "More actions" }));
    await user.click(await screen.findByRole("menuitem", { name: "Discard all changes…" }));

    const dialog = await screen.findByRole("dialog", { name: "Discard changes?" });
    expect(within(dialog).getByText(/moved to the Trash/)).toBeVisible();
    expect(commands.changesDiscard).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole("button", { name: "Discard changes" }));
    expect(commands.changesDiscard).toHaveBeenCalledWith("/repo", [
      expect.objectContaining({ path: "a.txt" }),
    ]);
  });

  it("asks before discarding the selected file with Cmd+Backspace", async () => {
    const user = userEvent.setup();
    setup([change("a.txt", null, "modified")]);
    const list = await screen.findByRole("listbox");
    list.focus();
    await user.keyboard("{Meta>}{Backspace}{/Meta}");
    expect(await screen.findByRole("dialog", { name: "Discard changes?" })).toBeVisible();
    expect(commands.changesDiscard).not.toHaveBeenCalled();
  });

  it("commits with Cmd+Enter but not while an IME is composing", async () => {
    const user = userEvent.setup();
    setup([change("a.txt", "modified", null)]);
    const summary = await screen.findByPlaceholderText("Summary (required)");
    await user.type(summary, "한글 요약");

    // A composing Enter (Korean IME) must not submit.
    summary.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        metaKey: true,
        isComposing: true,
        bubbles: true,
      }),
    );
    expect(commands.commitCreate).not.toHaveBeenCalled();

    await user.keyboard("{Meta>}{Enter}{/Meta}");
    expect(commands.commitCreate).toHaveBeenCalledWith("/repo", "한글 요약", "", [], false);
    expect(await screen.findByPlaceholderText("Summary (required)")).toHaveValue("");
  });

  it("disables committing until something is staged", async () => {
    const user = userEvent.setup();
    setup([change("a.txt", null, "modified")]);
    await user.type(await screen.findByPlaceholderText("Summary (required)"), "Fix");
    expect(screen.getByRole("button", { name: "Commit to main" })).toBeDisabled();
    expect(screen.getByText("Select files to include in the commit.")).toBeVisible();
  });

  it("prefills the last commit when amending", async () => {
    const user = userEvent.setup();
    setup([change("a.txt", null, "modified")]);
    await user.click(await screen.findByRole("checkbox", { name: "Amend last commit" }));
    expect(await screen.findByDisplayValue("Previous summary")).toBeVisible();
    expect(screen.getByDisplayValue("Previous body")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Amend last commit" }));
    expect(commands.commitCreate).toHaveBeenCalledWith(
      "/repo",
      "Previous summary",
      "Previous body",
      [],
      true,
    );
  });

  it("asks for an identity before the first commit", async () => {
    const user = userEvent.setup();
    setup([change("a.txt", "added", null)]);
    vi.mocked(commands.identityGet).mockResolvedValue(ok({ name: null, email: null }));
    vi.mocked(commands.identitySet).mockResolvedValue(ok(null));

    await user.type(await screen.findByPlaceholderText("Summary (required)"), "First");
    await user.click(screen.getByRole("button", { name: "Commit to main" }));

    const dialog = await screen.findByRole("dialog", { name: "Who's making this commit?" });
    await user.type(within(dialog).getByLabelText("Name"), "김가람");
    await user.type(within(dialog).getByLabelText("Email"), "garam@example.com");
    await user.click(within(dialog).getByRole("button", { name: "Save and commit" }));

    expect(commands.identitySet).toHaveBeenCalledWith("김가람", "garam@example.com");
    expect(commands.commitCreate).toHaveBeenCalledWith("/repo", "First", "", [], false);
  });

  it("stages single lines from the margin, keeping lines already staged", async () => {
    const user = userEvent.setup();
    setup([change("a.txt", "modified", "modified")]);
    await screen.findByText("new line");
    const boxes = screen.getAllByRole("checkbox", { name: "Include this line in the commit" });
    expect(boxes.map((b) => b.getAttribute("aria-checked"))).toEqual(["false", "false", "true"]);

    await user.click(boxes[1]);
    expect(commands.changesStageLines).toHaveBeenCalledWith(
      "/repo",
      expect.objectContaining({ path: "a.txt" }),
      expect.arrayContaining([
        { kind: "added", line: 2 },
        { kind: "added", line: 1 },
      ]),
    );
    expect(vi.mocked(commands.changesStageLines).mock.calls[0][2]).toHaveLength(2);
    // Shown as included right away, before git answers.
    expect(boxes[1]).toHaveAttribute("aria-checked", "true");
  });

  it("drags across the margin to include several lines at once", async () => {
    const user = userEvent.setup();
    setup([change("a.txt", null, "modified")]);
    await screen.findByText("new line");
    const [first, second] = screen.getAllByRole("checkbox", {
      name: "Include this line in the commit",
    });
    await user.pointer([
      { keys: "[MouseLeft>]", target: first },
      { target: second },
      { keys: "[/MouseLeft]", target: second },
    ]);
    expect(commands.changesStageLines).toHaveBeenCalledTimes(1);
    expect(vi.mocked(commands.changesStageLines).mock.calls[0][2]).toEqual(
      expect.arrayContaining([
        { kind: "deleted", line: 1 },
        { kind: "added", line: 1 },
        { kind: "added", line: 2 },
      ]),
    );
  });

  it("toggles a whole block from its header", async () => {
    const user = userEvent.setup();
    setup([change("a.txt", "modified", "modified")]);
    await user.click(await screen.findByRole("button", { name: "Include block" }));
    expect(vi.mocked(commands.changesStageLines).mock.calls[0][2]).toHaveLength(3);
  });

  it("shows an empty state when the working folder is clean", async () => {
    setup([]);
    expect(await screen.findByText("No local changes")).toBeVisible();
  });
});

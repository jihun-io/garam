import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  commands,
  type FileChange,
  type Account,
  type Identity,
  type RepoIdentity,
  type RepoStatus,
} from "../../ipc";
import { axeViolations } from "../../test/axe";
import { renderWithQuery } from "../../test/renderWithQuery";
import { ChangesView } from "./ChangesView";
import { useAmendSessions } from "./amendStore";
import { useCommitDrafts } from "./commitDraftStore";

const GLOBAL: Identity = { name: "Garam", email: "garam@example.com" };
const NONE: Identity = { name: null, email: null };

const PERSONAL: Account = {
  key: "github.com/1",
  host: "github.com",
  login: "jihun-io",
  name: "김지훈",
  avatarUrl: "",
  emails: ["kim@jihun.io"],
  noreplyEmail: "1+jihun-io@users.noreply.github.com",
};
const WORK: Account = {
  ...PERSONAL,
  key: "github.com/2",
  login: "cw-jihun-io",
  emails: ["jh.kim@causeworks.co.kr"],
  noreplyEmail: "2+cw-jihun-io@users.noreply.github.com",
};

/** The repository's account setup: signed-in accounts and the chosen one. */
function mockAccounts(accounts: Account[], chosen: string | null) {
  vi.mocked(commands.githubAccounts).mockResolvedValue({
    accounts,
    authorizationSettingsUrl: "",
  });
  vi.mocked(commands.repoList).mockResolvedValue({
    repositories: [
      {
        path: "/repo",
        name: "repo",
        addedAt: 0,
        lastOpenedAt: 0,
        missing: false,
        account: chosen,
        editor: null,
      },
    ],
    selected: "/repo",
  });
  vi.mocked(commands.remoteInfo).mockResolvedValue(
    ok({
      remotes: [{ name: "origin", url: "https://github.com/jihun-io/garam.git" }],
      defaultRemote: "origin",
      lastFetchedAt: null,
    }),
  );
}

function repoIdentity(inherited: Identity, local: Identity = NONE): RepoIdentity {
  return {
    effective: { name: local.name ?? inherited.name, email: local.email ?? inherited.email },
    local,
    inherited,
  };
}

vi.mock("../../ipc/bindings", () => ({
  commands: {
    statusGet: vi.fn(),
    sshKeys: vi.fn(),
    sshRepoKey: vi.fn(),
    sshSetRepoKey: vi.fn(),
    diffGet: vi.fn(),
    diffImages: vi.fn(),
    changesStage: vi.fn(),
    changesUnstage: vi.fn(),
    changesStageLines: vi.fn(),
    changesDiscard: vi.fn(),
    commitCreate: vi.fn(),
    commitCheck: vi.fn(),
    amendBegin: vi.fn(),
    amendStatus: vi.fn(),
    amendDiff: vi.fn(),
    amendImages: vi.fn(),
    amendEdit: vi.fn(),
    amendCheck: vi.fn(),
    amendSave: vi.fn(),
    amendCancel: vi.fn(),
    commitIgnore: vi.fn(),
    commitHead: vi.fn(),
    identityGet: vi.fn(),
    identitySet: vi.fn(),
    identitySetLocal: vi.fn(),
    identityClearLocal: vi.fn(),
    externalReveal: vi.fn(),
    githubAccounts: vi.fn(),
    repoList: vi.fn(),
    repoSetAccount: vi.fn(),
    remoteInfo: vi.fn(),
    conflictState: vi.fn(),
    branchBaseStatus: vi.fn(),
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

/** A diff line's whole text, though changed words are wrapped on their own. */
const lineText = (text: string) => (_: string, element: Element | null) =>
  element?.tagName === "SPAN" && element.textContent === text;

function setup(files: FileChange[]) {
  const status: RepoStatus = {
    branch: { head: "main", oid: "abc", upstream: null, ahead: 0, behind: 0 },
    files,
    unpushedTags: [],
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
  vi.mocked(commands.identityGet).mockResolvedValue(ok(repoIdentity(GLOBAL)));
  mockAccounts([], null);
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
  vi.mocked(commands.commitCheck).mockResolvedValue(ok([]));
  vi.mocked(commands.commitIgnore).mockResolvedValue(ok(null));
  return renderWithQuery(<ChangesView repo="/repo" />);
}

/** A line's selection box is named after the line. */
const LINE = /^(Added|Deleted) line \d+: /;

describe("ChangesView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAmendSessions.setState({ sessions: {}, drafts: {} });
    useCommitDrafts.setState({ drafts: {} });
  });

  it("lists files and shows the first file's diff", async () => {
    setup([change("src/app.ts", null, "modified"), change("새 파일.md", null, "untracked")]);
    expect(await screen.findByText("2 changed files")).toBeVisible();
    expect(screen.getByRole("option", { name: /app\.ts/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(await screen.findByText(lineText("new line"))).toBeVisible();
    expect(screen.getByText(lineText("old line"))).toBeVisible();
    // The word that changed is marked on its own.
    expect(screen.getByText("new")).not.toBe(screen.getByText(lineText("new line")));
    expect(screen.getByText("old")).toBeVisible();
  });

  it("stages and unstages with the checkboxes", async () => {
    const user = userEvent.setup();
    setup([change("a.txt", null, "modified"), change("b.txt", "modified", null)]);

    const a = await screen.findByRole("option", { name: /a\.txt/ });
    expect(a).toHaveAttribute("aria-checked", "false");
    await user.click(a.querySelector("[data-checkmark]")!);
    expect(commands.changesStage).toHaveBeenCalledWith("/repo", [
      expect.objectContaining({ path: "a.txt" }),
    ]);

    const b = screen.getByRole("option", { name: /b\.txt/ });
    expect(b).toHaveAttribute("aria-checked", "true");
    await user.click(b.querySelector("[data-checkmark]")!);
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
  });

  const amendSession = {
    id: "abcd",
    head: {
      oid: "abc",
      summary: "Previous summary",
      body: "Previous body\n\nCo-authored-by: Friend <friend@example.com>",
    },
  };
  function prepareAmend(files = [change("a.txt", "added", null)]) {
    vi.mocked(commands.amendBegin).mockResolvedValue(ok(amendSession));
    vi.mocked(commands.amendStatus).mockResolvedValue(
      ok({
        branch: { head: "main", oid: "abc", upstream: null, ahead: 1, behind: 0 },
        files,
        unpushedTags: [],
      }),
    );
    vi.mocked(commands.amendDiff).mockImplementation((repo, _id, file) =>
      commands.diffGet(repo, file),
    );
    vi.mocked(commands.amendEdit).mockResolvedValue(ok(null));
    vi.mocked(commands.amendCheck).mockResolvedValue(ok([]));
    vi.mocked(commands.amendSave).mockResolvedValue(ok("def"));
    vi.mocked(commands.amendCancel).mockResolvedValue(ok(null));
  }

  it("edits the whole last commit in a private index and preserves its trailers", async () => {
    const user = userEvent.setup();
    setup([change("new.txt", null, "untracked")]);
    prepareAmend([change("a.txt", "added", null), change("new.txt", null, "untracked")]);
    await user.click(await screen.findByRole("button", { name: "Edit Last Commit…" }));
    expect(await screen.findByDisplayValue("Previous summary")).toBeVisible();
    expect(await axeViolations(document.body)).toEqual([]);
    expect(screen.getByRole("textbox", { name: "Description" })).toHaveValue(
      amendSession.head.body,
    );
    expect(await screen.findByRole("option", { name: /a.txt/ })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(commands.amendDiff).toHaveBeenCalledWith(
      "/repo",
      "abcd",
      expect.objectContaining({ path: "a.txt" }),
    );
    await user.click(screen.getByRole("button", { name: "Save commit" }));
    await waitFor(() =>
      expect(commands.amendSave).toHaveBeenCalledWith(
        "/repo",
        "abcd",
        `Previous summary\n\n${amendSession.head.body}`,
      ),
    );
    expect(commands.amendCheck).toHaveBeenCalledWith("/repo", "abcd");
    expect(commands.commitCreate).not.toHaveBeenCalled();
  });

  it("excludes committed files through the private index and cancels back to the normal draft", async () => {
    const user = userEvent.setup();
    setup([change("new.txt", null, "untracked")]);
    prepareAmend();
    await user.type(
      await screen.findByPlaceholderText("Summary (required)"),
      "Unfinished new commit",
    );
    await user.click(screen.getByRole("button", { name: "Edit Last Commit…" }));
    await screen.findByDisplayValue("Previous summary");
    const list = await screen.findByRole("listbox");
    list.focus();
    await user.keyboard(" ");
    await waitFor(() =>
      expect(commands.amendEdit).toHaveBeenCalledWith("/repo", "abcd", {
        kind: "files",
        files: [change("a.txt", "added", null)],
        include: false,
      }),
    );
    expect(commands.changesUnstage).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Cancel edit" }));
    expect(await screen.findByDisplayValue("Unfinished new commit")).toBeVisible();
    expect(commands.amendCancel).toHaveBeenCalledWith("/repo", "abcd");
    expect(commands.amendSave).not.toHaveBeenCalled();
  });

  it("keeps the edited message on stale HEAD and ignores IME Enter shortcuts", async () => {
    const user = userEvent.setup();
    setup([]);
    prepareAmend();
    vi.mocked(commands.amendSave).mockResolvedValue({
      status: "error",
      error: { kind: "head_moved", params: {}, detail: null },
    });
    await user.click(await screen.findByRole("button", { name: "Edit Last Commit…" }));
    const summary = await screen.findByDisplayValue("Previous summary");
    await user.clear(summary);
    await user.type(summary, "수정한 메시지");
    fireEvent.keyDown(summary, { key: "Enter", metaKey: true, isComposing: true });
    expect(commands.amendSave).not.toHaveBeenCalled();
    fireEvent.keyDown(summary, { key: "Enter", metaKey: true, keyCode: 229 });
    expect(commands.amendSave).not.toHaveBeenCalled();
    await user.keyboard("{Meta>}{Enter}{/Meta}");
    expect(await screen.findByRole("alert")).toHaveTextContent("The last commit changed");
    expect(summary).toHaveValue("수정한 메시지");
    expect(useAmendSessions.getState().drafts["/repo"].summary).toBe("수정한 메시지");
  });

  it("shows safety findings and excludes them from the private index", async () => {
    const user = userEvent.setup();
    setup([]);
    prepareAmend([change(".env", "added", null)]);
    vi.mocked(commands.amendCheck)
      .mockResolvedValueOnce(
        ok([{ kind: "secret", path: ".env", secret: "env_file", line: null, preview: null }]),
      )
      .mockResolvedValue(ok([]));
    await user.click(await screen.findByRole("button", { name: "Edit Last Commit…" }));
    await screen.findByDisplayValue("Previous summary");
    await user.click(screen.getByRole("button", { name: "Save commit" }));
    const dialog = await screen.findByRole("dialog", { name: "Check before committing" });
    expect(commands.amendSave).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "Exclude from commit" }));
    await waitFor(() =>
      expect(commands.amendEdit).toHaveBeenCalledWith(
        "/repo",
        "abcd",
        expect.objectContaining({ kind: "files", include: false }),
      ),
    );
    expect(commands.changesUnstage).not.toHaveBeenCalled();
    await user.click(await within(dialog).findByRole("button", { name: "Save commit" }));
    await waitFor(() => expect(commands.amendSave).toHaveBeenCalledTimes(1));
  });

  it("fills the form once with a waiting draft", async () => {
    useCommitDrafts.getState().set("/repo", { summary: "Undone work", description: "Why." });
    setup([change("a.txt", "modified", null)]);
    expect(await screen.findByDisplayValue("Undone work")).toBeVisible();
    expect(screen.getByDisplayValue("Why.")).toBeVisible();
    await waitFor(() => expect(useCommitDrafts.getState().drafts).toEqual({}));
  });

  it("asks for an identity before the first commit", async () => {
    const user = userEvent.setup();
    setup([change("a.txt", "added", null)]);
    vi.mocked(commands.identityGet).mockResolvedValue(ok(repoIdentity(NONE)));
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

  it("shows the author and overrides it for this repository", async () => {
    const user = userEvent.setup();
    setup([change("a.txt", "added", null)]);
    vi.mocked(commands.identitySetLocal).mockResolvedValue(ok(null));

    await user.click(
      await screen.findByRole("button", { name: /Author\s*Garam <garam@example.com>/ }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Commit author for this repository",
    });
    await user.click(
      within(dialog).getByRole("radio", { name: /Use a different author in this repository/ }),
    );
    // The name starts from the global one; the email has to be typed.
    expect(within(dialog).getByLabelText("Name")).toHaveValue("Garam");
    expect(within(dialog).getByRole("button", { name: "Save" })).toBeDisabled();
    await user.type(within(dialog).getByLabelText("Email"), "kim@example.com");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(commands.identitySetLocal).toHaveBeenCalledWith("/repo", "Garam", "kim@example.com");
  });

  it("goes back to the global author", async () => {
    const user = userEvent.setup();
    setup([change("a.txt", "added", null)]);
    vi.mocked(commands.identityGet).mockResolvedValue(
      ok(repoIdentity(GLOBAL, { name: "Kim", email: "kim@example.com" })),
    );
    vi.mocked(commands.identityClearLocal).mockResolvedValue(ok(null));

    await user.click(await screen.findByRole("button", { name: /This repository/ }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("radio", { name: /Use my global Git settings/ }));
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(commands.identityClearLocal).toHaveBeenCalledWith("/repo");
  });

  it("chooses the suggested account and an email from it", async () => {
    const user = userEvent.setup();
    setup([change("a.txt", "added", null)]);
    mockAccounts([WORK, PERSONAL], null);
    vi.mocked(commands.repoSetAccount).mockResolvedValue(ok(null));
    vi.mocked(commands.identitySetLocal).mockResolvedValue(ok(null));

    await user.click(await screen.findByRole("button", { name: /Author/ }));
    const dialog = await screen.findByRole("dialog", {
      name: "Account and author for this repository",
    });
    // The remote's owner is jihun-io.
    await user.click(within(dialog).getByRole("combobox", { name: "GitHub account" }));
    await user.click(await screen.findByRole("option", { name: /@jihun-io .* suggested/ }));
    expect(within(dialog).getByText(/sign in as @jihun-io/)).toBeVisible();
    // The global author email isn't on that account.
    expect(
      within(dialog).getByText(/garam@example.com isn't on the @jihun-io account/),
    ).toBeVisible();

    await user.click(
      within(dialog).getByRole("radio", { name: /Use a different author in this repository/ }),
    );
    await user.click(within(dialog).getByRole("button", { name: "kim@jihun.io" }));
    expect(within(dialog).queryByText(/isn't on the @jihun-io account/)).toBeNull();
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(commands.repoSetAccount).toHaveBeenCalledWith("/repo", "github.com/1");
    expect(commands.identitySetLocal).toHaveBeenCalledWith("/repo", "Garam", "kim@jihun.io");
  });

  it("chooses an SSH key for an SSH remote, suggesting the account's", async () => {
    const user = userEvent.setup();
    setup([change("a.txt", "added", null)]);
    mockAccounts([WORK, PERSONAL], "github.com/1");
    vi.mocked(commands.remoteInfo).mockResolvedValue(
      ok({
        remotes: [{ name: "origin", url: "git@github.com:jihun-io/garam.git" }],
        defaultRemote: "origin",
        lastFetchedAt: null,
      }),
    );
    vi.mocked(commands.sshKeys).mockResolvedValue(
      ok([
        { path: "/Users/me/.ssh/id_ed25519", kind: "ssh-ed25519", comment: "kim@jihun.io" },
        { path: "/Users/me/.ssh/work", kind: "ssh-ed25519", comment: "jh.kim@causeworks.co.kr" },
      ]),
    );
    vi.mocked(commands.sshRepoKey).mockResolvedValue(ok({ type: "none" }));
    vi.mocked(commands.sshSetRepoKey).mockResolvedValue(ok(null));

    await user.click(await screen.findByRole("button", { name: /Author/ }));
    const dialog = await screen.findByRole("dialog");
    const picker = await within(dialog).findByRole("combobox", { name: "SSH key" });
    expect(picker).toHaveTextContent("My SSH settings");
    await user.click(picker);
    // The chosen account is jihun-io, whose email is on id_ed25519.
    await user.click(
      await screen.findByRole("option", { name: "id_ed25519 (kim@jihun.io) — suggested" }),
    );
    expect(within(dialog).getByText(/use only this key/)).toBeVisible();
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(commands.sshSetRepoKey).toHaveBeenCalledWith("/repo", "/Users/me/.ssh/id_ed25519");
  });

  it("keeps an SSH command the user wrote unless they pick another", async () => {
    const user = userEvent.setup();
    setup([change("a.txt", "added", null)]);
    vi.mocked(commands.remoteInfo).mockResolvedValue(
      ok({
        remotes: [{ name: "origin", url: "git@github.com:jihun-io/garam.git" }],
        defaultRemote: "origin",
        lastFetchedAt: null,
      }),
    );
    vi.mocked(commands.sshKeys).mockResolvedValue(ok([]));
    vi.mocked(commands.sshRepoKey).mockResolvedValue(
      ok({ type: "custom", command: "ssh -F ~/.ssh/work_config" }),
    );
    vi.mocked(commands.sshSetRepoKey).mockReset();

    await user.click(await screen.findByRole("button", { name: /Author/ }));
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByRole("combobox", { name: "SSH key" })).toHaveTextContent(
      "Keep the current command",
    );
    expect(within(dialog).getByText(/run “ssh -F ~\/.ssh\/work_config”/)).toBeVisible();
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(commands.sshSetRepoKey).not.toHaveBeenCalled();
  });

  it("warns when the author email isn't on the repository's account", async () => {
    setup([change("a.txt", "added", null)]);
    mockAccounts([WORK, PERSONAL], "github.com/1");
    expect(await screen.findByRole("button", { name: /@jihun-io/ })).toBeVisible();
    expect(await screen.findByText(/This email isn't on the @jihun-io account/)).toBeVisible();
  });

  it("stages single lines from the margin, keeping lines already staged", async () => {
    const user = userEvent.setup();
    setup([change("a.txt", "modified", "modified")]);
    await screen.findByText(lineText("new line"));
    const boxes = screen.getAllByRole("checkbox", { name: LINE });
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

  it("keeps a newly included line checked while the diff refreshes", async () => {
    const user = userEvent.setup();
    const { client } = setup([change("a.txt", "modified", "modified")]);
    await screen.findByText(lineText("new line"));
    // A tiny git with one added line, staged or not. Like the engine, the
    // diff answers from the index whatever flags it is asked with.
    let staged = true;
    const flags = () => change("a.txt", staged ? "modified" : null, "modified");
    vi.mocked(commands.statusGet).mockImplementation(async () =>
      ok({
        branch: { head: "main", oid: "abc", upstream: null, ahead: 0, behind: 0 },
        files: [flags()],
        unpushedTags: [],
      }),
    );
    vi.mocked(commands.diffGet).mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return ok({
        type: "text",
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
                text: "new line",
                oldLine: null,
                newLine: 1,
                noNewline: false,
                staged,
              },
            ],
          },
        ],
        selectable: true,
      });
    });
    vi.mocked(commands.changesStageLines).mockImplementation(async (_, __, selected) => {
      staged = selected.length > 0;
      return ok(null);
    });

    await client.invalidateQueries();
    const box = () => screen.getByRole("checkbox", { name: LINE });
    await waitFor(() => expect(box()).toHaveAttribute("aria-checked", "true"));
    // Leave it out, so the diff for "partly staged" flags was last seen
    // with the line unstaged.
    await user.click(box());
    await waitFor(() => expect(box()).toHaveAttribute("aria-checked", "false"));
    await new Promise((resolve) => setTimeout(resolve, 50));

    const seen: (string | null)[] = [];
    const observer = new MutationObserver(() => seen.push(box().getAttribute("aria-checked")));
    observer.observe(document.body, { subtree: true, attributes: true, childList: true });
    await user.click(box());
    await new Promise((resolve) => setTimeout(resolve, 100));
    observer.disconnect();

    expect(box()).toHaveAttribute("aria-checked", "true");
    expect(seen).not.toContain("false");
  });

  it("has no accessibility violations", async () => {
    const { container } = setup([
      change("a.txt", null, "modified"),
      change("b.txt", "modified", null),
    ]);
    await screen.findByText(lineText("new line"));
    expect(await axeViolations(container)).toEqual([]);
  });

  it("is one tab stop; arrow keys move between lines and Space includes one", async () => {
    const user = userEvent.setup();
    setup([change("a.txt", null, "modified")]);
    await screen.findByText(lineText("new line"));
    const block = screen.getByRole("button", { name: "Include block" });
    const lines = screen.getAllByRole("checkbox", { name: LINE });
    expect([block, ...lines].filter((el) => el.tabIndex === 0)).toEqual([block]);

    block.focus();
    await user.keyboard("{ArrowDown}");
    await waitFor(() => expect(lines[0]).toHaveFocus());
    expect(lines[0]).toHaveAccessibleName("Deleted line 1: old line");
    await user.keyboard("{ArrowDown}");
    await waitFor(() => expect(lines[1]).toHaveFocus());
    await user.keyboard(" ");
    expect(commands.changesStageLines).toHaveBeenCalledWith(
      "/repo",
      expect.objectContaining({ path: "a.txt" }),
      // Plus the line that was already staged.
      [
        { kind: "added", line: 2 },
        { kind: "added", line: 1 },
      ],
    );
  });

  it("drags across the margin to include several lines at once", async () => {
    const user = userEvent.setup();
    setup([change("a.txt", null, "modified")]);
    await screen.findByText(lineText("new line"));
    const [first, second] = screen.getAllByRole("checkbox", { name: LINE });
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

  // jsdom reports a non-Mac platform, so Ctrl is the toggle and select-all key.
  it("selects several files like a file manager and acts on them together", async () => {
    const user = userEvent.setup();
    const { container } = setup([
      change("a.txt", null, "modified"),
      change("b.txt", "modified", null),
      change("c.txt", null, "modified"),
      change("d.txt", null, "untracked"),
    ]);
    const list = await screen.findByRole("listbox");
    expect(list).toHaveAttribute("aria-multiselectable", "true");
    const row = (name: string) => screen.getByRole("option", { name: new RegExp(name) });
    const selected = () =>
      screen
        .getAllByRole("option")
        .filter((o) => o.getAttribute("aria-selected") === "true")
        .map((o) => o.textContent?.match(/\w\.txt/)?.[0]);

    await user.click(row("a.txt"));
    await user.keyboard("{Shift>}");
    await user.click(row("c.txt"));
    await user.keyboard("{/Shift}");
    expect(selected()).toEqual(["a.txt", "b.txt", "c.txt"]);
    expect(await screen.findByRole("heading", { name: "3 files selected" })).toBeVisible();
    expect(await axeViolations(container)).toEqual([]);

    await user.keyboard("{Control>}");
    await user.click(row("b.txt"));
    await user.keyboard("{/Control}");
    expect(selected()).toEqual(["a.txt", "c.txt"]);

    // Space includes them all, since not all are included yet.
    list.focus();
    await user.keyboard(" ");
    expect(vi.mocked(commands.changesStage).mock.calls[0][1].map((f) => f.path)).toEqual([
      "a.txt",
      "c.txt",
    ]);

    // The keyboard stays on the row just deselected; Shift+arrow extends
    // from there.
    await user.keyboard("{Shift>}{ArrowDown}{/Shift}");
    expect(selected()).toEqual(["b.txt", "c.txt"]);

    await user.keyboard("{Control>}a{/Control}");
    expect(selected()).toEqual(["a.txt", "b.txt", "c.txt", "d.txt"]);

    await user.keyboard("{Control>}{Backspace}{/Control}");
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/4/)).toBeVisible();
  });

  it("acts on the whole selection from a selected file's context menu", async () => {
    const user = userEvent.setup();
    setup([
      change("a.txt", null, "modified"),
      change("b.txt", null, "modified"),
      change("c.txt", null, "modified"),
    ]);
    const list = await screen.findByRole("listbox");
    list.focus();
    await user.keyboard("{Control>}a{/Control}");
    await user.pointer({
      keys: "[MouseRight]",
      target: screen.getByRole("option", { name: /b\.txt/ }),
    });
    expect(
      await screen.findByRole("menuitem", { name: "Discard changes to 3 files…" }),
    ).toBeVisible();
    expect(screen.getByRole("menuitem", { name: "Stash 3 files…" })).toBeVisible();
    await user.keyboard("{Escape}");

    // Outside the selection, it's just that file.
    await user.click(screen.getByRole("option", { name: /a\.txt/ }));
    await user.pointer({
      keys: "[MouseRight]",
      target: screen.getByRole("option", { name: /c\.txt/ }),
    });
    expect(await screen.findByRole("menuitem", { name: "Discard changes…" })).toBeVisible();
  });

  it("warns before committing a secret and commits anyway when asked", async () => {
    const user = userEvent.setup();
    setup([change("config.js", "modified", null)]);
    vi.mocked(commands.commitCheck).mockResolvedValue(
      ok([
        {
          kind: "secret",
          path: "config.js",
          secret: "github_token",
          line: 2,
          preview: "ghp_…6789",
        },
      ]),
    );
    await user.type(await screen.findByPlaceholderText("Summary (required)"), "Configure");
    await user.click(screen.getByRole("button", { name: /Commit to/ }));

    const dialog = await screen.findByRole("dialog", { name: "Check before committing" });
    expect(
      within(dialog).getByText("Line 2: what looks like a GitHub token, ghp_…6789"),
    ).toBeInTheDocument();
    expect(commands.commitCreate).not.toHaveBeenCalled();
    expect(await axeViolations(dialog)).toEqual([]);

    await user.click(within(dialog).getByRole("button", { name: "Commit anyway" }));
    expect(commands.commitCreate).toHaveBeenCalledWith("/repo", "Configure", "", [], false);
    // The dialog's submit stays in the dialog: the commit form must not
    // check (and open the dialog) again.
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Check before committing" })).toBeNull(),
    );
    expect(commands.commitCheck).toHaveBeenCalledTimes(1);
  });

  it("excludes a flagged file, checks again and then commits as planned", async () => {
    const user = userEvent.setup();
    setup([change("a.txt", "modified", null), change("video.mov", "added", null)]);
    vi.mocked(commands.commitCheck)
      .mockResolvedValueOnce(ok([{ kind: "large_file", path: "video.mov", mib: 120 }]))
      .mockResolvedValueOnce(ok([]));
    await user.type(await screen.findByPlaceholderText("Summary (required)"), "Add clip");
    await user.click(screen.getByRole("button", { name: /Commit to/ }));

    const dialog = await screen.findByRole("dialog", { name: "Check before committing" });
    expect(
      within(dialog).getByText(/GitHub refuses to push files larger than 100 MB/),
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Exclude from commit" }));
    expect(commands.changesUnstage).toHaveBeenCalledWith("/repo", [
      change("video.mov", "added", null),
    ]);
    await user.click(await within(dialog).findByRole("button", { name: "Commit" }));
    expect(commands.commitCreate).toHaveBeenCalledWith("/repo", "Add clip", "", [], false);
  });

  it("adds usually-ignored files to .gitignore and leaves them out", async () => {
    const user = userEvent.setup();
    setup([change("node_modules/a/index.js", "added", null)]);
    const paths = ["node_modules/a/index.js", "node_modules/b/index.js"];
    vi.mocked(commands.commitCheck)
      .mockResolvedValueOnce(ok([{ kind: "ignorable", pattern: "node_modules/", paths }]))
      .mockResolvedValueOnce(ok([]));
    await user.type(await screen.findByPlaceholderText("Summary (required)"), "Init");
    await user.click(screen.getByRole("button", { name: /Commit to/ }));

    const dialog = await screen.findByRole("dialog", { name: "Check before committing" });
    expect(within(dialog).getByText("2 files")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Add to .gitignore and exclude" }));
    expect(commands.commitIgnore).toHaveBeenCalledWith("/repo", ["node_modules/"], paths);
    expect(await within(dialog).findByRole("status")).toHaveTextContent(
      "All taken care of. The rest of your changes will be committed.",
    );
    expect(commands.commitCreate).not.toHaveBeenCalled();
  });

  it("tells when main moved on in a way that would conflict, unless conflicts are open", async () => {
    vi.mocked(commands.branchBaseStatus).mockResolvedValue(
      ok({
        base: "origin/main",
        baseBranch: "main",
        behind: 13,
        conflicts: ["app.txt"],
        published: true,
      }),
    );
    vi.mocked(commands.conflictState).mockResolvedValue(
      ok({ operation: null, files: [], empty: false }),
    );
    setup([change("a.txt", "modified", null)]);
    expect(await screen.findByText("main has 13 new commits")).toBeVisible();
  });

  it("shows an empty state when the working folder is clean", async () => {
    setup([]);
    expect(await screen.findByText("No local changes")).toBeVisible();
  });
});

import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  Account,
  Branch,
  BranchPullRequest,
  CommitSummary,
  PullRequest,
  PullRequestContext,
} from "../../ipc";
import { isCommandEnabled, runCommand } from "../../lib/commands";
import { axeViolations } from "../../test/axe";
import { renderWithQuery } from "../../test/renderWithQuery";
import { BranchControls } from "../branches/BranchControls";
import { ChangesView } from "../changes/ChangesView";
import { Notifications } from "../notify/Notifications";
import { useNotify } from "../notify/notifyStore";
import { DEFAULT_SETTINGS } from "../settings/api";
import { useSyncStore } from "../sync/syncStore";
import { branchPullRequest } from "./api";
import { headRef, readableBranch, suggestText } from "./fill";
import { usePullRequestDialog } from "./pullRequestDialogStore";

const responses: Record<string, unknown> = {};
const fns: Record<string, ReturnType<typeof vi.fn>> = {};

vi.mock("@tauri-apps/api/core", () => ({ Channel: class {} }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn(async () => {}) }));
// Every command is a spy answering with its canned response, or null.
vi.mock("../../ipc/bindings", () => ({
  commands: new Proxy(
    {},
    {
      get: (_, name: string) =>
        (fns[name] ??= vi.fn(async () =>
          name === "settingsGet" || name === "githubAccounts"
            ? responses[name]
            : { status: "ok", data: responses[name] ?? null },
        )),
    },
  ),
}));

const now = Math.floor(Date.now() / 1000);

const branch = (name: string, extra: Partial<Branch> = {}): Branch => ({
  name,
  kind: "local",
  remote: null,
  oid: "f".repeat(40),
  isHead: false,
  upstream: null,
  upstreamGone: false,
  ahead: 0,
  behind: 0,
  committedAt: now - 3600,
  subject: "work",
  ...extra,
});

const commit = (summary: string, oid = "c".repeat(40)): CommitSummary => ({
  oid,
  parents: [],
  authorName: "Me",
  authorEmail: "me@example.com",
  authoredAt: now,
  summary,
});

const pullRequest = (extra: Partial<PullRequest> = {}): PullRequest => ({
  number: 12,
  url: "https://github.com/me/garam/pull/12",
  title: "Add tag list",
  state: "open",
  draft: false,
  headBranch: "feature",
  headOwner: "me",
  headOid: "f".repeat(40),
  baseBranch: "main",
  checks: { state: "failure", total: 3, failed: 1, pending: 0 },
  review: "changes_requested",
  ...extra,
});

const ACCOUNT: Account = {
  key: "github.com/1",
  host: "github.com",
  login: "me",
  name: null,
  avatarUrl: "",
  emails: [],
  noreplyEmail: "1+me@users.noreply.github.com",
};

const NO_ACCOUNT: PullRequestContext = {
  status: "no_account",
  remote: "origin",
  defaultBranch: "main",
};

const READY: PullRequestContext = {
  status: "ready",
  head: { host: "github.com", owner: "me", name: "garam" },
  targets: [{ repo: { owner: "me", name: "garam", defaultBranch: "main" }, remote: "origin" }],
};

function setup({
  head = branch("feature", { isHead: true }),
  context = READY,
  list = [],
  commits = [commit("Add tag list")],
  accounts = [],
  withChanges = false,
}: {
  head?: Branch;
  context?: PullRequestContext;
  list?: BranchPullRequest[];
  commits?: CommitSummary[];
  accounts?: Account[];
  withChanges?: boolean;
} = {}) {
  responses.settingsGet = DEFAULT_SETTINGS;
  responses.githubAccounts = { accounts, authorizationSettingsUrl: "https://github.com/s" };
  responses.statusGet = {
    branch: {
      head: head.name,
      oid: head.oid,
      upstream: head.upstream,
      ahead: head.ahead,
      behind: 0,
    },
    files: [],
    unpushedTags: [],
  };
  responses.branchList = [
    head,
    branch("main", { upstream: "origin/main" }),
    branch("origin/main", { kind: "remote", remote: "origin" }),
    branch("origin/release", { kind: "remote", remote: "origin" }),
  ];
  responses.remoteInfo = {
    remotes: [{ name: "origin", url: "https://github.com/me/garam.git" }],
    defaultRemote: "origin",
    lastFetchedAt: now,
  };
  responses.pullRequestContext = context;
  responses.pullRequestList = list;
  responses.compareGet = {
    base: "b".repeat(40),
    target: head.oid,
    from: "b".repeat(40),
    ahead: commits.length,
    behind: 0,
    commits,
    files: commits.length ? [{ path: "tags.ts", origPath: null, kind: "added" }] : [],
  };
  responses.commitDetail = { ...commits[0], body: "Lists tags by version.", files: [] };
  responses.compareFileDiff = { type: "text", hunks: [], selectable: false };
  responses.pullRequestCreate = { number: 12, url: "https://github.com/me/garam/pull/12" };
  responses.conflictState = { operation: null, files: [], empty: false };
  responses.stashList = [];
  responses.identityGet = {
    effective: { name: "Me", email: "me@example.com" },
    local: { name: null, email: null },
    inherited: { name: "Me", email: "me@example.com" },
  };
  return renderWithQuery(
    <>
      <BranchControls repo="/repo" />
      {withChanges && <ChangesView repo="/repo" />}
      <Notifications />
    </>,
  );
}

async function openDialog() {
  await waitFor(() => expect(isCommandEnabled("branch.createPullRequest")).toBe(true));
  act(() => void runCommand("branch.createPullRequest"));
  return screen.findByRole("dialog", { name: "Create Pull Request" });
}

describe("filling a new pull request", () => {
  it("uses the only commit's message", () => {
    expect(
      suggestText({
        branch: "feat/tags",
        summaries: ["Add tag list"],
        singleBody: "Lists tags.",
        template: null,
      }),
    ).toEqual({ title: "Add tag list", body: "Lists tags." });
  });

  it("lists several commits oldest first under the branch name", () => {
    expect(
      suggestText({
        branch: "feat/tag-list",
        summaries: ["Second", "First"],
        singleBody: null,
        template: null,
      }),
    ).toEqual({ title: "Feat/tag list", body: "- First\n- Second" });
  });

  it("prefers the template for the body", () => {
    expect(
      suggestText({ branch: "x", summaries: ["A"], singleBody: "b", template: "## Why" }).body,
    ).toBe("## Why");
  });

  it("names the head by owner only when it comes from a fork", () => {
    const mine = { owner: "me", name: "garam" };
    expect(headRef(mine, { owner: "Me", name: "Garam" }, "feature")).toBe("feature");
    expect(headRef(mine, { owner: "up", name: "garam" }, "feature")).toBe("me:feature");
    expect(readableBranch("fix_login-bug")).toBe("Fix login bug");
  });

  it("shows a merged pull request only while the branch hasn't moved on", () => {
    const merged = pullRequest({ state: "merged", headOid: "a" });
    const list = [{ branch: "feature", pullRequest: merged }];
    expect(branchPullRequest(list, "feature", "a")).toBe(merged);
    expect(branchPullRequest(list, "feature", "b")).toBeNull();
    expect(branchPullRequest(list, "other", "a")).toBeNull();
  });
});

describe("pull requests in the toolbar", () => {
  beforeEach(() => {
    for (const fn of Object.values(fns)) fn.mockClear();
    vi.mocked(openUrl).mockClear();
    useNotify.setState({ notice: null });
    usePullRequestDialog.setState({ branch: null });
    useSyncStore.setState({ running: {} });
  });

  it("shows the current branch's pull request and opens it", async () => {
    const user = userEvent.setup();
    const { container } = setup({
      head: branch("feature", { isHead: true, upstream: "origin/feature" }),
      list: [{ branch: "feature", pullRequest: pullRequest() }],
    });
    const badge = await screen.findByRole("button", {
      name: "#12 · Pull request · 1 of 3 checks failed · Changes requested",
    });
    expect(within(badge).getByText("#12")).toBeVisible();
    expect(await axeViolations(container)).toEqual([]);
    await user.click(badge);
    expect(openUrl).toHaveBeenCalledWith("https://github.com/me/garam/pull/12");
    // The menu offers to view it rather than make another.
    expect(isCommandEnabled("branch.viewPullRequest")).toBe(true);
    expect(isCommandEnabled("branch.createPullRequest")).toBe(false);
  });

  it("shows nothing for a repository not on github.com", async () => {
    setup({ context: { status: "unsupported" } });
    await screen.findByRole("button", { name: /Current branch/ });
    await waitFor(() => expect(fns.pullRequestContext).toHaveBeenCalled());
    expect(isCommandEnabled("branch.createPullRequest")).toBe(false);
    expect(fns.pullRequestList).not.toHaveBeenCalled();
  });

  it("tags branches with open pull requests in the branch list", async () => {
    const user = userEvent.setup();
    setup({
      list: [
        {
          branch: "main",
          pullRequest: pullRequest({ number: 7, checks: null, review: "approved" }),
        },
      ],
    });
    await user.click(await screen.findByRole("button", { name: /Current branch/ }));
    const row = await screen.findByRole("button", { name: /^main/ });
    expect(await within(row).findByText("#7")).toBeVisible();
    expect(within(row).getByText("#7 · Pull request · Approved")).toBeInTheDocument();
  });
});

describe("suggesting a pull request", () => {
  beforeEach(() => {
    for (const fn of Object.values(fns)) fn.mockClear();
    useNotify.setState({ notice: null });
    usePullRequestDialog.setState({ branch: null });
    useSyncStore.setState({ running: {} });
  });

  const OFFER = /No pull request yet/;

  it("offers one in the toolbar and on the empty changes view", async () => {
    const user = userEvent.setup();
    setup({ withChanges: true });
    const offer = await screen.findByRole("button", { name: OFFER });
    expect(fns.compareGet).toHaveBeenCalledWith(
      "/repo",
      "refs/remotes/origin/main",
      "refs/heads/feature",
      "three_dot",
    );
    expect(await screen.findByRole("button", { name: "Create Pull Request…" })).toBeVisible();
    await user.click(offer);
    expect(await screen.findByRole("dialog", { name: "Create Pull Request" })).toBeVisible();
  });

  it("offers nothing on the default branch", async () => {
    setup({
      head: branch("main", { isHead: true, upstream: "origin/main", ahead: 2 }),
      withChanges: true,
    });
    await screen.findByRole("button", { name: /Current branch/ });
    await waitFor(() => expect(fns.pullRequestList).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: OFFER })).toBeNull();
    expect(screen.queryByRole("button", { name: "Create Pull Request…" })).toBeNull();
    // The menu still has it, and explains why it can't be made.
    expect(isCommandEnabled("branch.createPullRequest")).toBe(true);
  });

  it("offers one without an account, and asks for an account", async () => {
    const user = userEvent.setup();
    setup({ context: NO_ACCOUNT, accounts: [ACCOUNT] });
    const offer = await screen.findByRole("button", { name: OFFER });
    // Without an account GitHub isn't asked; git knows the default branch.
    expect(fns.pullRequestList).not.toHaveBeenCalled();
    expect(fns.compareGet).toHaveBeenCalledWith(
      "/repo",
      "refs/remotes/origin/main",
      "refs/heads/feature",
      "three_dot",
    );
    await user.click(offer);
    const dialog = await screen.findByRole("dialog", { name: "Create Pull Request" });
    expect(await within(dialog).findByRole("button", { name: "Choose Account…" })).toBeVisible();
  });

  it("still offers one when GitHub hides the repository, and says why", async () => {
    const user = userEvent.setup();
    setup({
      context: {
        status: "blocked",
        remote: "origin",
        defaultBranch: "main",
        error: { kind: "github_oauth_app_restricted", params: {}, detail: "HTTP 403" },
      },
    });
    await user.click(await screen.findByRole("button", { name: OFFER }));
    const dialog = await screen.findByRole("dialog", { name: "Create Pull Request" });
    expect(within(dialog).getByText(/hasn't approved Garam yet/)).toBeVisible();
    await user.click(
      await within(dialog).findByRole("button", { name: "Open Garam's GitHub Settings" }),
    );
    expect(openUrl).toHaveBeenCalledWith("https://github.com/s");

    // Once the organization approves, checking again opens the form.
    responses.pullRequestContext = READY;
    await user.click(within(dialog).getByRole("button", { name: "Check Again" }));
    expect(await screen.findByLabelText("Title")).toBeVisible();
  });

  it("offers nothing without an account when git doesn't know the default branch", async () => {
    setup({ context: { ...NO_ACCOUNT, defaultBranch: null } });
    await screen.findByRole("button", { name: /Current branch/ });
    await waitFor(() => expect(fns.pullRequestContext).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: OFFER })).toBeNull();
    expect(fns.compareGet).not.toHaveBeenCalled();
  });

  it("offers nothing without commits the base lacks", async () => {
    setup({ head: branch("feature", { isHead: true, upstream: "origin/feature" }), commits: [] });
    await waitFor(() => expect(fns.compareGet).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: OFFER })).toBeNull();
  });
});

describe("creating a pull request", () => {
  beforeEach(() => {
    for (const fn of Object.values(fns)) fn.mockClear();
    vi.mocked(openUrl).mockClear();
    useNotify.setState({ notice: null });
    usePullRequestDialog.setState({ branch: null });
    useSyncStore.setState({ running: {} });
  });

  it("fills from the commit, publishes the branch, then creates it", async () => {
    const user = userEvent.setup();
    setup();
    const dialog = await openDialog();
    const title = within(dialog).getByLabelText("Title");
    await waitFor(() => expect(title).toHaveValue("Add tag list"));
    expect(within(dialog).getByLabelText("Description")).toHaveValue("Lists tags by version.");
    expect(within(dialog).getByText("1 commit · 1 file")).toBeVisible();
    expect(within(dialog).getByText(/isn't on origin yet/)).toBeVisible();
    // The base is up to date before comparing.
    expect(fns.remoteFetch).toHaveBeenCalledWith(
      expect.any(String),
      "/repo",
      "origin",
      false,
      expect.anything(),
    );
    expect(fns.compareGet).toHaveBeenCalledWith(
      "/repo",
      "refs/remotes/origin/main",
      "refs/heads/feature",
      "three_dot",
    );

    await user.click(within(dialog).getByRole("checkbox", { name: "Create as a draft" }));
    await user.click(within(dialog).getByRole("button", { name: "Publish and Create" }));

    await screen.findByText("Created pull request #12.");
    expect(fns.remotePublish).toHaveBeenCalledWith(
      expect.any(String),
      "/repo",
      "origin",
      expect.anything(),
    );
    expect(fns.pullRequestCreate).toHaveBeenCalledWith("/repo", "me", "garam", {
      title: "Add tag list",
      body: "Lists tags by version.",
      head: "feature",
      base: "main",
      draft: true,
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Open in Browser" }));
    expect(openUrl).toHaveBeenCalledWith("https://github.com/me/garam/pull/12");
  });

  it("keeps what the user typed when the base changes", async () => {
    const user = userEvent.setup();
    setup({ head: branch("feature", { isHead: true, upstream: "origin/feature" }) });
    const dialog = await openDialog();
    const title = within(dialog).getByLabelText("Title");
    await waitFor(() => expect(title).toHaveValue("Add tag list"));
    await user.clear(title);
    await user.type(title, "My title");
    await user.click(within(dialog).getByRole("combobox", { name: "Base branch" }));
    await user.click(await screen.findByRole("option", { name: "release" }));
    expect(title).toHaveValue("My title");
    expect(fns.compareGet).toHaveBeenCalledWith(
      "/repo",
      "refs/remotes/origin/release",
      "refs/heads/feature",
      "three_dot",
    );
    // Already pushed: nothing to send first.
    expect(within(dialog).getByRole("button", { name: "Create Pull Request" })).toBeEnabled();
  });

  it("can't create one with nothing the base lacks", async () => {
    setup({ head: branch("feature", { isHead: true, upstream: "origin/feature" }), commits: [] });
    const dialog = await openDialog();
    expect(
      await within(dialog).findByText("This branch has nothing that main lacks."),
    ).toBeVisible();
    expect(within(dialog).getByRole("button", { name: "Create Pull Request" })).toBeDisabled();
  });

  it("won't ask to merge main into itself", async () => {
    const user = userEvent.setup();
    setup({ head: branch("main", { isHead: true, upstream: "origin/main", ahead: 2 }) });
    const dialog = await openDialog();
    expect(await within(dialog).findByText(/this is main itself/)).toBeVisible();
    expect(within(dialog).getByRole("button", { name: "Create Pull Request" })).toBeDisabled();
    // Nothing would be pushed for it.
    expect(within(dialog).queryByText(/pushed first/)).toBeNull();
    await user.click(within(dialog).getByRole("button", { name: "New Branch…" }));
    expect(screen.queryByRole("dialog", { name: "Create Pull Request" })).toBeNull();
    expect(await screen.findByRole("dialog", { name: "Create a branch" })).toBeVisible();
  });

  it("asks for an account first", async () => {
    setup({
      context: NO_ACCOUNT,
      accounts: [
        {
          key: "github.com/1",
          host: "github.com",
          login: "me",
          name: null,
          avatarUrl: "",
          emails: [],
          noreplyEmail: "1+me@users.noreply.github.com",
        },
      ],
    });
    const dialog = await openDialog();
    expect(
      await within(dialog).findByText(
        "Choose the GitHub account to use for this repository first.",
      ),
    ).toBeVisible();
    expect(within(dialog).getByRole("button", { name: "Choose Account…" })).toBeVisible();
    expect(fns.pullRequestCreate).not.toHaveBeenCalled();
  });

  it("shows the organization's block with a way to ask for access", async () => {
    const user = userEvent.setup();
    setup({ head: branch("feature", { isHead: true, upstream: "origin/feature" }) });
    fns.pullRequestCreate.mockResolvedValueOnce({
      status: "error",
      error: { kind: "github_oauth_app_restricted", params: {}, detail: "HTTP 403" },
    });
    const dialog = await openDialog();
    await waitFor(() => expect(within(dialog).getByLabelText("Title")).toHaveValue("Add tag list"));
    await user.click(within(dialog).getByRole("button", { name: "Create Pull Request" }));
    expect(await within(dialog).findByText(/hasn't approved Garam yet/)).toBeVisible();
    await user.click(within(dialog).getByRole("button", { name: "Open Garam's GitHub Settings" }));
    expect(openUrl).toHaveBeenCalledWith("https://github.com/s");
  });
});

import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { commands, type ConflictState, type Stash } from "../../ipc";
import { axeViolations } from "../../test/axe";
import { renderWithQuery } from "../../test/renderWithQuery";
import { ChangesView } from "../changes/ChangesView";
import { Notifications } from "../notify/Notifications";
import { useNotify } from "../notify/notifyStore";
import { DEFAULT_SETTINGS } from "../settings/api";
import { usePendingStash } from "./pendingStore";
import { useStashSection } from "./sectionStore";

const responses: Record<string, unknown> = {};
const fns: Record<string, ReturnType<typeof vi.fn>> = {};

// Every command is a spy answering with its canned response, or null.
// Settings come back as they are rather than as a Result.
vi.mock("../../ipc/bindings", () => ({
  commands: new Proxy(
    {},
    {
      get: (_, name: string) =>
        (fns[name] ??= vi.fn(async () =>
          name === "settingsGet"
            ? responses[name]
            : { status: "ok", data: responses[name] ?? null },
        )),
    },
  ),
}));

const now = Math.floor(Date.now() / 1000);

const STASH: Stash = {
  oid: "a".repeat(40),
  base: "b".repeat(40),
  name: "stash@{0}",
  branch: "main",
  message: "half-done login",
  auto: false,
  hasUntracked: true,
  createdAt: now - 3600,
};

const NO_CONFLICTS: ConflictState = { operation: null, files: [], empty: false };

function setup({
  stashes = [STASH],
  conflicts = NO_CONFLICTS,
}: { stashes?: Stash[]; conflicts?: ConflictState } = {}) {
  responses.settingsGet = DEFAULT_SETTINGS;
  responses.statusGet = {
    branch: { head: "main", oid: "abc", upstream: null, ahead: 0, behind: 0 },
    files: [
      { path: "a.txt", origPath: null, staged: null, unstaged: "modified", isSubmodule: false },
    ],
    unpushedTags: [],
  };
  responses.conflictState = conflicts;
  responses.stashList = stashes;
  responses.stashFiles = [
    { path: "a.txt", origPath: null, kind: "modified" },
    { path: "new.txt", origPath: null, kind: "untracked" },
  ];
  responses.stashFileDiff = { type: "text", hunks: [], selectable: false };
  responses.diffGet = { type: "text", selectable: false, hunks: [] };
  responses.identityGet = {
    effective: { name: "Me", email: "me@example.com" },
    local: { name: null, email: null },
    inherited: { name: "Me", email: "me@example.com" },
  };
  return renderWithQuery(
    <>
      <ChangesView repo="/repo" />
      <Notifications />
    </>,
  );
}

async function openStash(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: /Stashed changes/ }));
  await user.click(screen.getByRole("button", { name: /half-done login/ }));
  return screen.findByRole("heading", { name: "half-done login" });
}

describe("stashes in the changes view", () => {
  beforeEach(() => {
    for (const fn of Object.values(fns)) fn.mockClear();
    for (const key of Object.keys(responses)) delete responses[key];
    useNotify.setState({ notice: null });
    useStashSection.setState({ open: false });
    usePendingStash.setState({ pending: {} });
  });

  it("lists stashes under the files, closed until opened", async () => {
    const user = userEvent.setup();
    const { container } = setup();
    const header = await screen.findByRole("button", { name: /Stashed changes/ });
    expect(header).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: /half-done login/ })).toBeNull();

    expect(await openStash(user)).toBeVisible();
    expect(header).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("On main")).toBeVisible();
    // Untracked files are listed with the rest.
    expect(await screen.findByRole("button", { name: /new\.txt/ })).toBeVisible();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("hides the section without stashes", async () => {
    setup({ stashes: [] });
    await screen.findByRole("option", { name: /a\.txt/ });
    expect(screen.queryByRole("button", { name: /Stashed changes/ })).toBeNull();
  });

  it("restores a stash and removes it", async () => {
    const user = userEvent.setup();
    responses.stashApply = "applied";
    setup();
    await openStash(user);
    await user.click(screen.getByRole("button", { name: "Restore" }));
    expect(commands.stashApply).toHaveBeenCalledWith("/repo", STASH.oid, true);
    expect(await screen.findByText("Stashed changes restored.")).toBeVisible();
  });

  it("applies a stash and says what was lost when the index didn't fit", async () => {
    const user = userEvent.setup();
    responses.stashApply = "applied_unstaged";
    setup();
    await openStash(user);
    await user.click(screen.getByRole("button", { name: "Apply" }));
    expect(commands.stashApply).toHaveBeenCalledWith("/repo", STASH.oid, false);
    expect(await screen.findByText(/None are included now/)).toBeVisible();
  });

  it("discards a stash after asking, and can undo it", async () => {
    const user = userEvent.setup();
    setup();
    await openStash(user);
    await user.click(screen.getByRole("button", { name: "More" }));
    await user.click(await screen.findByRole("menuitem", { name: "Discard…" }));
    const dialog = await screen.findByRole("dialog", { name: "Discard stashed changes?" });
    expect(commands.stashDrop).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "Discard" }));
    expect(commands.stashDrop).toHaveBeenCalledWith("/repo", STASH.oid);

    expect(await screen.findByText("Stashed changes discarded.")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(commands.stashRestore).toHaveBeenCalledWith("/repo", STASH.oid);
  });

  it("creates a branch from a stash", async () => {
    const user = userEvent.setup();
    setup();
    await openStash(user);
    await user.click(screen.getByRole("button", { name: "More" }));
    await user.click(await screen.findByRole("menuitem", { name: "Create Branch from Here…" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Create a Branch from Stashed Changes",
    });
    await user.type(within(dialog).getByLabelText("Branch name"), "rescue login");
    await user.click(within(dialog).getByRole("button", { name: "Create and Restore" }));
    expect(commands.stashBranch).toHaveBeenCalledWith("/repo", STASH.oid, "rescue-login");
  });

  it("stashes all changes with a message", async () => {
    const user = userEvent.setup();
    const { container } = setup({ stashes: [] });
    await user.click(await screen.findByRole("button", { name: "More actions" }));
    await user.click(await screen.findByRole("menuitem", { name: "Stash All Changes…" }));
    const dialog = await screen.findByRole("dialog", { name: "Stash Changes" });
    expect(await axeViolations(container)).toEqual([]);
    await user.type(within(dialog).getByLabelText("Message"), "before the demo");
    await user.click(within(dialog).getByRole("checkbox", { name: "Stash untracked files too" }));
    await user.click(within(dialog).getByRole("button", { name: "Stash" }));
    expect(commands.stashPush).toHaveBeenCalledWith("/repo", "before the demo", false, []);
    expect(await screen.findByText("Changes stashed.")).toBeVisible();
  });

  it("stashes one file from its context menu", async () => {
    const user = userEvent.setup();
    setup({ stashes: [] });
    const row = await screen.findByRole("option", { name: /a\.txt/ });
    await user.pointer({ keys: "[MouseRight]", target: row });
    await user.click(await screen.findByRole("menuitem", { name: "Stash This File…" }));
    const dialog = await screen.findByRole("dialog", { name: "Stash Selected Files" });
    expect(within(dialog).getByText(/only the changes to a\.txt/)).toBeVisible();
    await user.click(within(dialog).getByRole("button", { name: "Stash" }));
    expect(commands.stashPush).toHaveBeenCalledWith("/repo", null, true, ["a.txt"]);
  });

  it("explains conflicts from a restore, then offers to discard the stash", async () => {
    const user = userEvent.setup();
    responses.stashApply = "conflicted";
    const conflicted: ConflictState = {
      operation: null,
      files: [{ path: "a.txt", kind: "both_modified", hasMarkers: true }],
      empty: false,
    };
    const view = setup();
    await openStash(user);
    responses.conflictState = conflicted;
    await user.click(screen.getByRole("button", { name: "Restore" }));
    expect(await screen.findByText("Restoring stashed changes ran into conflicts")).toBeVisible();
    expect(screen.queryByText("Stashed changes restored.")).toBeNull();

    // Resolved: the stash git kept can go.
    responses.conflictState = NO_CONFLICTS;
    view.unmount();
    setup();
    expect(await screen.findByText("All conflicts are resolved")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Discard from Stash List" }));
    expect(commands.stashDrop).toHaveBeenCalledWith("/repo", STASH.oid);
  });
});

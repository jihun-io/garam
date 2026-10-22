import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { commands, type ConflictState } from "../../ipc";
import { axeViolations } from "../../test/axe";
import { renderWithQuery } from "../../test/renderWithQuery";
import { ChangesView } from "../changes/ChangesView";
import { Notifications } from "../notify/Notifications";
import { useNotify } from "../notify/notifyStore";

const responses: Record<string, unknown> = {};
const fns: Record<string, ReturnType<typeof vi.fn>> = {};

// Every command is a spy answering with its canned response, or null.
vi.mock("../../ipc/bindings", () => ({
  commands: new Proxy(
    {},
    {
      get: (_, name: string) =>
        (fns[name] ??= vi.fn(async () => ({ status: "ok", data: responses[name] ?? null }))),
    },
  ),
}));

const conflicted = {
  path: "a.txt",
  origPath: null,
  staged: "conflicted" as const,
  unstaged: "conflicted" as const,
  isSubmodule: false,
};

function setup(state: ConflictState) {
  responses.statusGet = {
    branch: { head: "main", oid: "abc", upstream: null, ahead: 0, behind: 0 },
    files: state.files.length > 0 ? [conflicted] : [],
  };
  responses.conflictState = state;
  responses.identityGet = { name: "Me", email: "me@example.com" };
  responses.diffGet = { type: "text", selectable: false, hunks: [] };
  return renderWithQuery(
    <>
      <ChangesView repo="/repo" />
      <Notifications />
    </>,
  );
}

const stopped: ConflictState = {
  operation: "merge",
  files: [{ path: "a.txt", kind: "both_modified", hasMarkers: true }],
};

describe("conflict resolution", () => {
  beforeEach(() => {
    for (const fn of Object.values(fns)) fn.mockClear();
    useNotify.setState({ notice: null });
  });

  it("explains the stopped merge and replaces the commit form", async () => {
    setup(stopped);
    // The banner's title; the loading indicator is a status too.
    const banner = (await screen.findByText("Merge in progress")).closest('[role="status"]');
    expect(banner).toHaveTextContent("Merge in progress");
    expect(banner).toHaveTextContent("1 conflicted file left");
    expect(screen.getByRole("button", { name: "Commit merge" })).toBeDisabled();
    expect(screen.queryByPlaceholderText("Summary (required)")).toBeNull();
    // Ticking a conflicted file would mark it resolved with markers left in.
    const file = screen.getByRole("option", { name: /a\.txt/ });
    await userEvent.click(file.querySelector("[data-checkmark]")!);
    expect(commands.changesStage).not.toHaveBeenCalled();
  });

  it("has no accessibility violations", async () => {
    const { container } = setup(stopped);
    await screen.findByText("Merge in progress");
    expect(await axeViolations(container)).toEqual([]);
  });

  it("keeps one side of a file", async () => {
    const user = userEvent.setup();
    setup(stopped);
    const actions = await screen.findByRole("group", { name: "Resolve conflict" });
    expect(actions).toHaveTextContent("Both sides changed this file.");
    await user.click(within(actions).getByRole("button", { name: "Use my changes" }));
    expect(commands.conflictResolve).toHaveBeenCalledWith("/repo", "a.txt", "mine");
  });

  it("asks before marking a file with markers resolved", async () => {
    const user = userEvent.setup();
    setup(stopped);
    await user.click(await screen.findByRole("button", { name: "Mark as resolved" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Conflict markers are still in this file",
    });
    expect(commands.conflictMarkResolved).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "Mark as resolved anyway" }));
    expect(commands.conflictMarkResolved).toHaveBeenCalledWith("/repo", "a.txt");
  });

  it("marks a cleaned-up file resolved right away", async () => {
    const user = userEvent.setup();
    setup({ operation: "rebase", files: [{ ...stopped.files[0], hasMarkers: false }] });
    expect(await screen.findByText("Rebase in progress")).toBeVisible();
    await user.click(await screen.findByRole("button", { name: "Mark as resolved" }));
    expect(commands.conflictMarkResolved).toHaveBeenCalledWith("/repo", "a.txt");
  });

  it("continues once everything is resolved", async () => {
    const user = userEvent.setup();
    setup({ operation: "merge", files: [] });
    expect(await screen.findByText("All conflicts are resolved. You can continue.")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Commit merge" }));
    expect(commands.conflictContinue).toHaveBeenCalledWith("/repo");
    expect(await screen.findByText("Merge committed.")).toBeVisible();
  });

  it("aborts only after confirming", async () => {
    const user = userEvent.setup();
    setup(stopped);
    await user.click(await screen.findByRole("button", { name: "Abort…" }));
    const dialog = await screen.findByRole("dialog", { name: "Abort the merge?" });
    expect(commands.conflictAbort).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "Abort merge" }));
    expect(commands.conflictAbort).toHaveBeenCalledWith("/repo");
    expect(await screen.findByText("Stopped. Your branch is back to how it was.")).toBeVisible();
  });

  it("shows the commit form when nothing is in progress", async () => {
    setup({ operation: null, files: [] });
    expect(await screen.findByPlaceholderText("Summary (required)")).toBeVisible();
    expect(screen.queryByRole("status")).toBeNull();
  });
});

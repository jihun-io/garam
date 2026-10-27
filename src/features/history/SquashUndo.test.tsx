import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { commands, type SquashUndo } from "../../ipc";
import { isCommandEnabled, runCommand } from "../../lib/commands";
import { axeViolations } from "../../test/axe";
import { renderWithQuery } from "../../test/renderWithQuery";
import { Notifications } from "../notify/Notifications";
import { useNotify } from "../notify/notifyStore";
import { SquashUndoCommand, SquashUndoDialog } from "./SquashUndo";
import { squashUndoKey, useSquashUndoDialog } from "./squashUndoStore";

vi.mock("../../ipc/bindings", () => ({
  commands: { squashUndoGet: vi.fn(), squashUndo: vi.fn() },
}));
const ok = <T,>(data: T) => ({ status: "ok" as const, data });
const info: SquashUndo = {
  id: "a".repeat(40),
  branch: "feature",
  before: "1".repeat(40),
  after: "2".repeat(40),
  count: 3,
  available: true,
  contentChanged: false,
};

function setup() {
  return renderWithQuery(
    <>
      <SquashUndoCommand repo="/repo" />
      <SquashUndoDialog />
      <Notifications />
    </>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  useSquashUndoDialog.setState({ request: null });
  useNotify.setState({ notice: null });
  vi.mocked(commands.squashUndoGet).mockResolvedValue(ok(info));
  vi.mocked(commands.squashUndo).mockResolvedValue(ok(info));
});

describe("squash undo", () => {
  it("offers a restored record in the menu without showing an old completion notice", async () => {
    const user = userEvent.setup();
    setup();
    await waitFor(() => expect(isCommandEnabled("history.undoSquash")).toBe(true));
    expect(screen.queryByRole("status")).toBeNull();
    act(() => {
      runCommand("history.undoSquash");
    });
    const dialog = await screen.findByRole("dialog", { name: "Undo Squash of 3 Commits" });
    expect(within(dialog).getByText("/repo · feature")).toBeVisible();
    expect(within(dialog).getByText(/Remote branches are kept/)).toBeVisible();
    expect(commands.squashUndo).not.toHaveBeenCalled();
    expect(await axeViolations(dialog)).toEqual([]);
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(commands.squashUndo).not.toHaveBeenCalled();
  });

  it("shows a completion action for a new squash and confirms the exact repository and id", async () => {
    const user = userEvent.setup();
    const { client } = setup();
    await waitFor(() => expect(isCommandEnabled("history.undoSquash")).toBe(true));
    const next = { ...info, id: "b".repeat(40) };
    act(() => client.setQueryData(squashUndoKey("/repo"), next));
    await user.click(await screen.findByRole("button", { name: "Undo Squash of 3 Commits" }));
    const dialog = await screen.findByRole("dialog", { name: "Undo Squash of 3 Commits" });
    vi.mocked(commands.squashUndoGet).mockResolvedValue(ok(null));
    await user.click(within(dialog).getByRole("button", { name: "Undo Squash" }));
    expect(commands.squashUndo).toHaveBeenCalledWith("/repo", next.id);
    expect(
      await screen.findByText("Undid the squash and restored the original commits."),
    ).toBeVisible();
  });

  it("explains conflict result preservation and retains errors for a moved head", async () => {
    const user = userEvent.setup();
    vi.mocked(commands.squashUndo).mockResolvedValue({
      status: "error",
      error: { kind: "head_moved", params: {}, detail: null },
    });
    setup();
    act(() =>
      useSquashUndoDialog.getState().open("/original-repo", { ...info, contentChanged: true }),
    );
    const dialog = await screen.findByRole("dialog", { name: "Undo Squash of 3 Commits" });
    expect(within(dialog).getByText(/including your conflict resolutions/)).toBeVisible();
    expect(within(dialog).getByText("/original-repo · feature")).toBeVisible();
    await user.click(within(dialog).getByRole("button", { name: "Undo Squash" }));
    expect(commands.squashUndo).toHaveBeenCalledWith("/original-repo", info.id);
    expect(await within(dialog).findByRole("alert")).toBeVisible();
    expect(screen.getByRole("dialog")).toBeVisible();
  });

  it("disables the command after another operation moves the branch", async () => {
    vi.mocked(commands.squashUndoGet).mockResolvedValue(ok({ ...info, available: false }));
    setup();
    await waitFor(() => expect(commands.squashUndoGet).toHaveBeenCalled());
    expect(isCommandEnabled("history.undoSquash")).toBe(false);
    expect(runCommand("history.undoSquash")).toBe(false);
    expect(commands.squashUndo).not.toHaveBeenCalled();
  });
});

import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { commands, type CleanupCandidate, type DeletedBranch } from "../../ipc";
import { axeViolations } from "../../test/axe";
import { renderWithQuery } from "../../test/renderWithQuery";
import { Notifications } from "../notify/Notifications";
import { useNotify } from "../notify/notifyStore";
import { CleanupDialog } from "./CleanupDialog";

vi.mock("../../ipc/bindings", () => ({
  commands: {
    branchCleanupCandidates: vi.fn(),
    branchDeleteMany: vi.fn(),
    branchRestore: vi.fn(),
  },
}));

/** Closes for real, so the notice behind it can be reached. */
function Harness({ onClose }: { onClose: () => void }) {
  const [open, setOpen] = useState(true);
  return open ? (
    <CleanupDialog
      repo="/repo"
      onClose={() => {
        onClose();
        setOpen(false);
      }}
    />
  ) : null;
}

const ok = <T,>(data: T) => ({ status: "ok" as const, data });
const candidate = (c: Partial<CleanupCandidate> & { name: string }): CleanupCandidate => ({
  reason: "merged",
  unmerged: 0,
  committedAt: Math.floor(Date.now() / 1000) - 3600,
  ...c,
});

describe("CleanupDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useNotify.setState({ notice: null });
  });

  it("ticks only branches that can go without losing commits, and can undo", async () => {
    const user = userEvent.setup();
    vi.mocked(commands.branchCleanupCandidates).mockResolvedValue(
      ok([
        candidate({ name: "feature/done" }),
        candidate({ name: "fix/typo", reason: "gone" }),
        candidate({ name: "spike", reason: "gone", unmerged: 2 }),
      ]),
    );
    const deleted: DeletedBranch[] = [
      { name: "feature/done", oid: "a", remote: "origin", merge: "refs/heads/feature/done" },
      { name: "fix/typo", oid: "b", remote: null, merge: null },
    ];
    vi.mocked(commands.branchDeleteMany).mockResolvedValue(ok(deleted));
    vi.mocked(commands.branchRestore).mockResolvedValue(ok(null));
    const onClose = vi.fn();
    renderWithQuery(
      <>
        <Harness onClose={onClose} />
        <Notifications />
      </>,
    );

    const dialog = await screen.findByRole("dialog", { name: "Clean Up Branches" });
    expect(await within(dialog).findByRole("checkbox", { name: /feature\/done/ })).toBeChecked();
    expect(within(dialog).getByRole("checkbox", { name: /fix\/typo/ })).toBeChecked();
    // Its commits are nowhere else: left for the user to decide.
    const spike = within(dialog).getByRole("checkbox", { name: /spike/ });
    expect(spike).not.toBeChecked();
    expect(within(dialog).getByText(/Has 2 commits the default branch doesn't/)).toBeVisible();
    expect(await axeViolations(dialog)).toEqual([]);

    await user.click(within(dialog).getByRole("button", { name: "Delete 2 Branches" }));
    expect(commands.branchDeleteMany).toHaveBeenCalledWith("/repo", ["feature/done", "fix/typo"]);
    expect(onClose).toHaveBeenCalled();

    expect(await screen.findByText("Deleted 2 branches.")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(commands.branchRestore).toHaveBeenCalledWith("/repo", deleted);
    expect(await screen.findByText("Brought back 2 branches.")).toBeVisible();
  });

  it("says so when there is nothing to clean up", async () => {
    vi.mocked(commands.branchCleanupCandidates).mockResolvedValue(ok([]));
    renderWithQuery(<CleanupDialog repo="/repo" onClose={() => {}} />);
    expect(await screen.findByText(/Nothing to clean up/)).toBeVisible();
    expect(screen.queryByRole("button", { name: /Delete/ })).toBeNull();
  });
});

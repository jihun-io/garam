import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { commands } from "../../../ipc";
import { renderWithQuery } from "../../../test/renderWithQuery";
import { AddRepositoryDialog } from "./AddRepositoryDialog";

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("../../../ipc/bindings", () => ({
  commands: { repoAdd: vi.fn(), repoInitExisting: vi.fn(), repoList: vi.fn() },
}));

const entry = {
  path: "/work/site",
  name: "site",
  addedAt: 0,
  lastOpenedAt: 0,
  account: null,
  editor: null,
  missing: false,
};

describe("AddRepositoryDialog", () => {
  beforeEach(() => vi.clearAllMocks());

  it("offers to create a repository when the folder isn't one", async () => {
    const user = userEvent.setup();
    vi.mocked(commands.repoAdd).mockResolvedValue({
      status: "error",
      error: { kind: "not_a_repository", params: {}, detail: null },
    });
    vi.mocked(commands.repoInitExisting).mockResolvedValue({ status: "ok", data: entry });
    const onClose = vi.fn();
    renderWithQuery(<AddRepositoryDialog onClose={onClose} />);

    await user.type(screen.getByLabelText("Repository folder"), "/work/site");
    await user.click(screen.getByRole("button", { name: "Add repository" }));
    expect(await screen.findByText("This folder isn't a Git repository.")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Create repository here" }));
    expect(commands.repoInitExisting).toHaveBeenCalledWith("/work/site");
    expect(onClose).toHaveBeenCalled();
  });

  it("opens prefilled with the error from a dropped folder", () => {
    renderWithQuery(
      <AddRepositoryDialog
        initialPath="/work/plain"
        initialError={{ kind: "not_a_repository", params: {}, detail: null }}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("Repository folder")).toHaveValue("/work/plain");
    expect(screen.getByRole("button", { name: "Create repository here" })).toBeVisible();
  });
});

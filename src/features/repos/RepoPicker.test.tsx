import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { commands, type RepositoryEntry } from "../../ipc";
import { renderWithQuery } from "../../test/renderWithQuery";
import { RepoPicker } from "./RepoPicker";

vi.mock("../../ipc/bindings", () => ({
  commands: {
    repoSelect: vi.fn().mockResolvedValue({ status: "ok", data: null }),
    repoList: vi.fn(),
  },
}));

const repo = (name: string, path: string, missing = false): RepositoryEntry => ({
  name,
  path,
  missing,
  addedAt: 0,
  lastOpenedAt: 0,
});

const repos = [
  repo("가람", "/Users/me/garam"),
  repo("blog", "/Users/me/sites/blog"),
  repo("old", "/Users/me/old", true),
];

describe("RepoPicker", () => {
  it("filters by name or path and selects with Enter", async () => {
    const user = userEvent.setup();
    renderWithQuery(<RepoPicker repositories={repos} selected={repos[0]} />);

    await user.click(screen.getByRole("button", { name: "Repository: 가람" }));
    expect(screen.getByText("Missing")).toBeVisible();

    await user.type(screen.getByRole("searchbox"), "sites");
    expect(screen.getByText("blog")).toBeVisible();
    expect(screen.queryByText("old")).not.toBeInTheDocument();

    await user.keyboard("{Enter}");
    expect(commands.repoSelect).toHaveBeenCalledWith("/Users/me/sites/blog");
  });

  it("explains when nothing matches", async () => {
    const user = userEvent.setup();
    renderWithQuery(<RepoPicker repositories={repos} selected={repos[0]} />);
    await user.click(screen.getByRole("button", { name: "Repository: 가람" }));
    await user.type(screen.getByRole("searchbox"), "zzz");
    expect(screen.getByText("No repositories match “zzz”.")).toBeVisible();
  });
});

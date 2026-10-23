import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { commands, type OpenRepositoryIn, type RepositoryEntry } from "../../ipc";
import { renderWithQuery } from "../../test/renderWithQuery";
import { DEFAULT_SETTINGS } from "../settings/api";
import { OpenRepositoryDialog } from "./dialogs/OpenRepositoryDialog";
import { RepoPicker } from "./RepoPicker";

vi.mock("../../ipc/bindings", () => ({
  commands: {
    repoSelect: vi.fn(),
    repoList: vi.fn(),
    settingsGet: vi.fn(),
    settingsSet: vi.fn(),
    windowFocusRepo: vi.fn(),
    windowOpen: vi.fn(),
  },
}));

const repo = (name: string, path: string, missing = false): RepositoryEntry => ({
  name,
  path,
  missing,
  addedAt: 0,
  lastOpenedAt: 0,
  account: null,
  editor: null,
});

const repos = [
  repo("가람", "/Users/me/garam"),
  repo("blog", "/Users/me/sites/blog"),
  repo("old", "/Users/me/old", true),
];

const ok = { status: "ok", data: null } as const;

function setUp(openRepositoryIn: OpenRepositoryIn = "ask") {
  vi.mocked(commands.settingsGet).mockResolvedValue({ ...DEFAULT_SETTINGS, openRepositoryIn });
  const user = userEvent.setup();
  renderWithQuery(
    <>
      <RepoPicker repositories={repos} selected={repos[0]} />
      <OpenRepositoryDialog />
    </>,
  );
  return user;
}

async function chooseBlog(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Current repository 가람" }));
  await user.type(screen.getByRole("searchbox"), "sites");
  await user.keyboard("{Enter}");
}

describe("RepoPicker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(commands.repoList).mockResolvedValue({
      repositories: repos,
      selected: repos[0].path,
    });
    vi.mocked(commands.repoSelect).mockResolvedValue(ok);
    vi.mocked(commands.settingsSet).mockResolvedValue(ok);
    vi.mocked(commands.windowFocusRepo).mockResolvedValue(false);
    vi.mocked(commands.windowOpen).mockResolvedValue(ok);
  });

  it("filters by name or path", async () => {
    const user = setUp();
    await user.click(screen.getByRole("button", { name: "Current repository 가람" }));
    expect(screen.getByText("Missing")).toBeVisible();

    await user.type(screen.getByRole("searchbox"), "sites");
    expect(screen.getByText("blog")).toBeVisible();
    expect(screen.queryByText("old")).not.toBeInTheDocument();
  });

  it("asks where to open, and can remember the answer", async () => {
    const user = setUp();
    await chooseBlog(user);

    expect(await screen.findByText("Where should blog open?")).toBeVisible();
    await user.click(screen.getByRole("checkbox", { name: "Don't ask again" }));
    await user.click(screen.getByRole("button", { name: "Open in New Window" }));

    expect(commands.windowOpen).toHaveBeenCalledWith("/Users/me/sites/blog");
    expect(commands.repoSelect).not.toHaveBeenCalled();
    expect(commands.settingsSet).toHaveBeenCalledWith(
      expect.objectContaining({ openRepositoryIn: "new_window" }),
    );
  });

  it("opens here without asking once that is the setting", async () => {
    const user = setUp("current_window");
    await chooseBlog(user);

    await vi.waitFor(() =>
      expect(commands.repoSelect).toHaveBeenCalledWith("/Users/me/sites/blog"),
    );
    expect(screen.queryByText("Where should blog open?")).not.toBeInTheDocument();
  });

  it("brings forward the window that already shows it", async () => {
    vi.mocked(commands.windowFocusRepo).mockResolvedValue(true);
    const user = setUp();
    await chooseBlog(user);

    await vi.waitFor(() =>
      expect(commands.windowFocusRepo).toHaveBeenCalledWith("/Users/me/sites/blog"),
    );
    expect(commands.repoSelect).not.toHaveBeenCalled();
    expect(commands.windowOpen).not.toHaveBeenCalled();
    expect(screen.queryByText("Where should blog open?")).not.toBeInTheDocument();
  });

  it("explains when nothing matches", async () => {
    const user = setUp();
    await user.click(screen.getByRole("button", { name: "Current repository 가람" }));
    await user.type(screen.getByRole("searchbox"), "zzz");
    expect(screen.getByText("No repositories match “zzz”.")).toBeVisible();
  });
});

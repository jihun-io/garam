import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { commands, type RepositoryEntry } from "../../ipc";
import { renderWithQuery } from "../../test/renderWithQuery";
import { DEFAULT_SETTINGS } from "../settings/api";
import { useOpenInLabels } from "./api";
import { MoreEditorsButton } from "./EditorMenu";

vi.mock("../../ipc/bindings", () => ({
  commands: {
    settingsGet: vi.fn(),
    repoList: vi.fn(),
    repoSetEditor: vi.fn(),
    externalEditors: vi.fn(),
    externalSuggestedEditors: vi.fn(),
    externalTerminals: vi.fn(),
    externalOpenEditor: vi.fn(),
  },
}));

const ok = <T,>(data: T) => ({ status: "ok" as const, data });

const repo = (editor: string | null): RepositoryEntry => ({
  path: "/repo",
  name: "repo",
  addedAt: 0,
  lastOpenedAt: 0,
  missing: false,
  account: null,
  editor,
});

function Labels() {
  const labels = useOpenInLabels("/repo");
  return <p>{labels["repo.openEditor"]}</p>;
}

function setup({ repoEditor = null as string | null, suggested = [] as string[] } = {}) {
  vi.mocked(commands.settingsGet).mockResolvedValue({ ...DEFAULT_SETTINGS, editor: "zed" });
  vi.mocked(commands.repoList).mockResolvedValue({
    repositories: [repo(repoEditor)],
    selected: "/repo",
  });
  vi.mocked(commands.repoSetEditor).mockResolvedValue(ok(null));
  vi.mocked(commands.externalEditors).mockResolvedValue(
    ok([
      { id: "vscode", name: "Visual Studio Code" },
      { id: "zed", name: "Zed" },
      { id: "xcode", name: "Xcode" },
    ]),
  );
  vi.mocked(commands.externalSuggestedEditors).mockResolvedValue(ok(suggested));
  vi.mocked(commands.externalTerminals).mockResolvedValue(ok([]));
  vi.mocked(commands.externalOpenEditor).mockResolvedValue(ok(null));
  return renderWithQuery(
    <>
      <Labels />
      <MoreEditorsButton path="/repo" />
    </>,
  );
}

describe("editor choice", () => {
  beforeEach(() => vi.clearAllMocks());

  it("names the settings' editor, and lists the rest with suited ones first", async () => {
    const user = userEvent.setup();
    setup({ suggested: ["xcode"] });
    expect(await screen.findByText("Open in Zed")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Open in Another Editor" }));
    const menu = await screen.findByRole("menu");
    const suited = within(menu).getByRole("group", { name: "Suited to this repository" });
    expect(within(suited).getByRole("menuitem", { name: "Open in Xcode" })).toBeInTheDocument();
    const others = within(menu).getByRole("group", { name: "Other apps" });
    expect(
      within(others)
        .getAllByRole("menuitem")
        .map((i) => i.textContent),
    ).toEqual(["Open in Visual Studio Code"]);

    await user.click(within(suited).getByRole("menuitem", { name: "Open in Xcode" }));
    expect(commands.externalOpenEditor).toHaveBeenCalledWith("xcode", "/repo");
  });

  it("uses the repository's own editor and lets it go back to the settings", async () => {
    const user = userEvent.setup();
    setup({ repoEditor: "xcode" });
    expect(await screen.findByText("Open in Xcode")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Open in Another Editor" }));
    await user.click(
      await screen.findByRole("menuitem", { name: "Default Editor for This Repository" }),
    );
    expect(await screen.findByRole("menuitemradio", { name: "Xcode" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    // Keyboard: jsdom has no layout for the pointer's path into a submenu.
    screen.getByRole("menuitemradio", { name: "Same as settings (Zed)" }).focus();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(commands.repoSetEditor).toHaveBeenCalledWith("/repo", null));
  });

  it("falls back to the settings when the repository's editor is gone", async () => {
    setup({ repoEditor: "sublime" });
    expect(await screen.findByText("Open in Zed")).toBeInTheDocument();
  });
});

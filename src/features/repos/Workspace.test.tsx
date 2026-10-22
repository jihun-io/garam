import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { RepositoryEntry } from "../../ipc";
import { renderWithQuery } from "../../test/renderWithQuery";
import { SettingsDialog } from "../settings/SettingsDialog";
import { Workspace } from "./Workspace";

const responses: Record<string, unknown> = {
  statusGet: {
    branch: { head: "main", oid: "abc", upstream: "origin/main", ahead: 1, behind: 0 },
    files: [],
  },
  branchList: [],
  remoteInfo: {
    remotes: [{ name: "origin", url: "https://example.com/repo.git" }],
    defaultRemote: "origin",
    lastFetchedAt: Math.floor(Date.now() / 1000),
  },
  identityGet: { name: "Me", email: "me@example.com" },
};

// Every command answers with its canned response, or null.
vi.mock("../../ipc/bindings", () => ({
  commands: new Proxy(
    {},
    { get: (_, name: string) => async () => ({ status: "ok", data: responses[name] ?? null }) },
  ),
}));

const repo: RepositoryEntry = {
  name: "garam",
  path: "/Users/me/garam",
  missing: false,
  addedAt: 0,
  lastOpenedAt: 0,
};

describe("Workspace", () => {
  afterEach(() => vi.restoreAllMocks());

  it("renders the repository toolbar without React key warnings", async () => {
    const consoleError = vi.spyOn(console, "error");
    renderWithQuery(<Workspace repositories={[repo]} selected={repo} />);

    expect(await screen.findByRole("button", { name: "Current branch: main" })).toBeVisible();
    expect(await screen.findByRole("button", { name: /Push origin/ })).toBeVisible();
    const keyWarnings = consoleError.mock.calls.filter((args) =>
      String(args[0]).includes("same key"),
    );
    expect(keyWarnings).toEqual([]);
  });

  it("opens settings from the toolbar", async () => {
    const user = userEvent.setup();
    renderWithQuery(
      <>
        <Workspace repositories={[repo]} selected={repo} />
        <SettingsDialog />
      </>,
    );
    await user.click(await screen.findByRole("button", { name: "Settings" }));
    const dialog = await screen.findByRole("dialog", { name: "Settings" });
    expect(within(dialog).getByRole("tab", { name: "General" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(within(dialog).getByLabelText("Language")).toBeVisible();
    await user.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { commands, type AppSettings } from "../../ipc";
import { renderWithQuery } from "../../test/renderWithQuery";
import { Notifications } from "../notify/Notifications";
import { DEFAULT_SETTINGS } from "./api";
import { SettingsDialog } from "./SettingsDialog";
import { useSettingsDialog } from "./settingsDialogStore";
import { SettingsEffects } from "./SettingsEffects";

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ setTheme: vi.fn(async () => {}) }),
}));
vi.mock("../../ipc/bindings", () => ({
  commands: {
    settingsGet: vi.fn(),
    settingsSet: vi.fn(),
    systemAccentColor: vi.fn(),
    gitGlobalGet: vi.fn(),
    gitGlobalSet: vi.fn(),
    externalEditors: vi.fn(),
    externalTerminals: vi.fn(),
  },
}));

const ok = <T,>(data: T) => ({ status: "ok" as const, data });

function setup(settings: Partial<AppSettings> = {}, systemAccent: string | null = "#953d96") {
  vi.mocked(commands.settingsGet).mockResolvedValue({ ...DEFAULT_SETTINGS, ...settings });
  vi.mocked(commands.settingsSet).mockResolvedValue(ok(null));
  vi.mocked(commands.systemAccentColor).mockResolvedValue(ok(systemAccent));
  vi.mocked(commands.gitGlobalGet).mockResolvedValue(
    ok({ userName: "Garam", userEmail: "garam@example.com", defaultBranch: null }),
  );
  vi.mocked(commands.gitGlobalSet).mockResolvedValue(ok(null));
  vi.mocked(commands.externalEditors).mockResolvedValue(
    ok([
      { id: "vscode", name: "Visual Studio Code" },
      { id: "zed", name: "Zed" },
    ]),
  );
  vi.mocked(commands.externalTerminals).mockResolvedValue(
    ok([{ id: "terminal", name: "Terminal" }]),
  );
  useSettingsDialog.setState({ open: true });
  return renderWithQuery(
    <>
      <SettingsEffects />
      <SettingsDialog />
      <Notifications />
    </>,
  );
}

/** Picks `option` in the custom select labelled `label`. */
async function choose(user: ReturnType<typeof userEvent.setup>, label: string, option: string) {
  await user.click(await screen.findByRole("combobox", { name: label }));
  await user.click(await screen.findByRole("option", { name: option }));
}

async function openSection(user: ReturnType<typeof userEvent.setup>, name: string) {
  const dialog = await screen.findByRole("dialog", { name: "Settings" });
  await user.click(within(dialog).getByRole("tab", { name }));
  return dialog;
}

describe("settings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.documentElement.removeAttribute("data-theme");
  });

  it("switches the theme right away and saves it", async () => {
    const user = userEvent.setup();
    setup();
    await openSection(user, "Appearance");
    await user.click(screen.getByRole("radio", { name: "Dark" }));
    expect(commands.settingsSet).toHaveBeenCalledWith({ ...DEFAULT_SETTINGS, theme: "dark" });
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(screen.getByRole("radio", { name: "Dark" })).toBeChecked();
  });

  it("uses the system accent color, made readable", async () => {
    const user = userEvent.setup();
    setup({ accent: "system" });
    await openSection(user, "Appearance");
    expect(await screen.findByText(/Uses your system's accent color/)).toBeVisible();
    await vi.waitFor(() =>
      expect(document.documentElement.style.getPropertyValue("--color-river")).toBe("#953d96"),
    );
  });

  it("explains when the system accent can't be read", async () => {
    const user = userEvent.setup();
    setup({}, null);
    await openSection(user, "Appearance");
    expect(await screen.findByText(/can't read the accent color/)).toBeVisible();
    const accents = screen.getByRole("radiogroup", { name: "Accent color" });
    expect(within(accents).getByRole("radio", { name: "System" })).toBeDisabled();
  });

  it("saves git settings when leaving the field", async () => {
    const user = userEvent.setup();
    setup();
    await openSection(user, "Git");
    const branch = await screen.findByLabelText("Default branch for new repositories");
    await user.type(branch, "trunk");
    expect(commands.gitGlobalSet).not.toHaveBeenCalled();
    await user.tab();
    expect(commands.gitGlobalSet).toHaveBeenCalledWith("default_branch", "trunk");
    expect(await screen.findByText("Saved")).toBeVisible();
  });

  it("shows why a git setting was refused", async () => {
    const user = userEvent.setup();
    setup();
    vi.mocked(commands.gitGlobalSet).mockResolvedValue({
      status: "error",
      error: { kind: "invalid_branch_name", params: {}, detail: null },
    });
    await openSection(user, "Git");
    const branch = await screen.findByLabelText("Default branch for new repositories");
    await user.type(branch, "bad name{enter}");
    expect(await screen.findByRole("alert")).toHaveTextContent("isn't a valid branch name");
  });

  it("chooses apps and the fetch interval", async () => {
    const user = userEvent.setup();
    setup();
    await openSection(user, "Apps");
    const editor = await screen.findByRole("combobox", { name: "Editor" });
    await vi.waitFor(() =>
      expect(editor).toHaveTextContent("First one found (Visual Studio Code)"),
    );
    await choose(user, "Editor", "Zed");
    expect(editor).toHaveTextContent("Zed");
    expect(commands.settingsSet).toHaveBeenLastCalledWith({ ...DEFAULT_SETTINGS, editor: "zed" });

    await openSection(user, "Sync");
    await choose(user, "Fetch in the background", "Never");
    expect(commands.settingsSet).toHaveBeenLastCalledWith({
      ...DEFAULT_SETTINGS,
      editor: "zed",
      fetchIntervalMinutes: 0,
    });
  });

  it("follows the system language unless one is chosen", async () => {
    const user = userEvent.setup();
    setup();
    const language = await screen.findByRole("combobox", { name: "Language" });
    expect(language).toHaveTextContent("System language");
    await choose(user, "Language", "한국어");
    expect(commands.settingsSet).toHaveBeenLastCalledWith({ ...DEFAULT_SETTINGS, language: "ko" });
    expect(await screen.findByRole("tab", { name: "일반" })).toBeVisible();
  });
});

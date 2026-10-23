import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { describe, expect, it, vi } from "vitest";

import { commands } from "../../ipc";
import { runCommand } from "../../lib/commands";
import { axeViolations } from "../../test/axe";
import { renderWithQuery } from "../../test/renderWithQuery";
import { AboutCommand, AboutWindow } from "./AboutWindow";

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ label: "about", setTitle: vi.fn(async () => {}) }),
}));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: vi.fn(async () => "0.1.0") }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn(async () => {}) }));
vi.mock("../../ipc/bindings", () => ({ commands: { windowOpenAbout: vi.fn() } }));

describe("About window", () => {
  it("opens the About window from the About command", () => {
    vi.mocked(commands.windowOpenAbout).mockResolvedValue({ status: "ok", data: null });
    renderWithQuery(<AboutCommand />);
    expect(runCommand("app.about")).toBe(true);
    expect(commands.windowOpenAbout).toHaveBeenCalledOnce();
  });

  it("shows the name, version and links", async () => {
    const user = userEvent.setup();
    const { container } = renderWithQuery(<AboutWindow />);
    expect(screen.getByRole("heading", { level: 1, name: "Garam" })).toBeVisible();
    expect(await screen.findByText("Version 0.1.0")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Website" }));
    expect(openUrl).toHaveBeenCalledWith("https://github.com/jihun-io/garam");
    expect(await axeViolations(container)).toEqual([]);
  });
});

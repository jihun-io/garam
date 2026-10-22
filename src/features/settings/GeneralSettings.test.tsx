import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { commands } from "../../ipc";
import { renderWithQuery } from "../../test/renderWithQuery";
import { DEFAULT_SETTINGS } from "./api";
import { GeneralSettings } from "./GeneralSettings";

vi.mock("../../lib/platform", () => ({ currentPlatform: () => "macos" }));
vi.mock("../../ipc/bindings", () => ({
  commands: {
    settingsGet: vi.fn(),
    settingsSet: vi.fn(),
    settingsLaunchLanguage: vi.fn(),
    appRestart: vi.fn(),
  },
}));

describe("general settings on macOS", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(commands.settingsSet).mockResolvedValue({ status: "ok", data: null });
  });

  it("offers a restart once the language differs from the one at launch", async () => {
    const user = userEvent.setup();
    vi.mocked(commands.settingsLaunchLanguage).mockResolvedValue(null);
    vi.mocked(commands.settingsGet).mockResolvedValue(DEFAULT_SETTINGS);
    renderWithQuery(<GeneralSettings />);

    const language = await screen.findByRole("combobox", { name: "Language" });
    expect(screen.queryByRole("button", { name: "Restart Now" })).toBeNull();

    await user.click(language);
    await user.click(await screen.findByRole("option", { name: "한국어" }));
    await user.click(await screen.findByRole("button", { name: "Restart Now" }));
    expect(commands.appRestart).toHaveBeenCalled();
  });
});

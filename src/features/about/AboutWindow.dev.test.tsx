import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import i18n from "../../i18n";
import { renderWithQuery } from "../../test/renderWithQuery";
import { AboutWindow } from "./AboutWindow";

const setTitle = vi.hoisted(() => vi.fn(async () => {}));

vi.mock("../../lib/appIdentity", () => ({
  appNameKey: "appNameDev",
  appIconUrl: "/icons/dev.png",
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: vi.fn(() => ({ setTitle })),
}));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: vi.fn(async () => "0.2.1") }));

describe("development About window", () => {
  it.each([
    ["en", "About Garam Dev"],
    ["ko", "Garam Dev에 관하여"],
  ])("uses the development name, icon and translated title in %s", async (language, title) => {
    await i18n.changeLanguage(language);
    const { container } = renderWithQuery(<AboutWindow />);
    expect(screen.getByRole("heading", { name: "Garam Dev" })).toBeVisible();
    expect(container.querySelector("img")).toHaveAttribute("src", "/icons/dev.png");
    expect(setTitle).toHaveBeenCalledWith(title);
  });
});

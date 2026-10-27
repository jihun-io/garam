import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { runCommand, useCommand } from "../../lib/commands";
import { renderWithQuery } from "../../test/renderWithQuery";
import { AppMenu } from "./AppMenu";
import { CommandList } from "./CommandList";
import { HelpCommands } from "./HelpCommands";

type FakeItem = {
  id?: string;
  text?: string;
  accelerator?: string;
  enabled?: boolean;
  item?: unknown;
  items?: FakeItem[];
  action?: () => void;
  setEnabled: ReturnType<typeof vi.fn>;
};

const built = vi.hoisted(() => ({
  menu: null as { items: unknown[] } | null,
  /** Holds `setAsAppMenu` back until resolved. */
  installed: Promise.resolve(),
}));

vi.mock("@tauri-apps/api/menu", () => {
  const make = async (opts: object) => ({ ...opts, setEnabled: vi.fn(async () => {}) });
  return {
    MenuItem: { new: make },
    PredefinedMenuItem: { new: make },
    Submenu: {
      new: async (opts: object) => ({
        ...opts,
        setAsWindowsMenuForNSApp: vi.fn(async () => {}),
        setAsHelpMenuForNSApp: vi.fn(async () => {}),
      }),
    },
    Menu: {
      new: async (opts: { items: unknown[] }) => {
        const menu = {
          ...opts,
          setAsAppMenu: vi.fn(() => built.installed),
          setAsWindowMenu: vi.fn(() => built.installed),
        };
        built.menu = menu;
        return menu;
      },
    },
  };
});
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn(async () => {}) }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true }));

function menuNamed(text: string): FakeItem {
  const menus = (built.menu?.items ?? []) as FakeItem[];
  const found = menus.find((m) => m.text === text);
  if (!found) throw new Error(`no menu ${text}`);
  return found;
}

function itemWithId(menu: FakeItem, id: string): FakeItem {
  // Outside Tauri the window counts as "main".
  const found = menu.items?.find((i) => i.id === `main/${id}`);
  if (!found) throw new Error(`no item ${id}`);
  return found;
}

function OfferPush({ enabled }: { enabled: boolean }) {
  useCommand("sync.push", () => {}, enabled);
  return null;
}

describe("menu bar", () => {
  beforeEach(() => {
    built.menu = null;
    built.installed = Promise.resolve();
  });

  it("builds translated menus with shortcuts", async () => {
    render(<AppMenu />);
    await vi.waitFor(() => expect(built.menu).not.toBeNull());
    // jsdom reports a non-Mac platform: settings and quit live in File.
    const file = menuNamed("File");
    expect(file.items?.map((i) => i.text ?? (i.item as string))).toEqual([
      "New Repository…",
      "Add Existing Repository…",
      "Clone Repository…",
      "Separator",
      "Settings…",
      "Separator",
      "Exit",
    ]);
    const push = itemWithId(menuNamed("Repository"), "sync.push");
    expect(push.text).toBe("Push");
    expect(itemWithId(menuNamed("Repository"), "history.undoSquash").text).toBe(
      "Undo Last Squash…",
    );
    expect(push.accelerator).toBe("CmdOrCtrl+Shift+P");
    expect(itemWithId(menuNamed("Repository"), "repo.reveal").text).toBe("Show in file manager");
  });

  it("enables items while a screen offers them", async () => {
    const { rerender } = render(
      <>
        <AppMenu />
        <OfferPush enabled={false} />
      </>,
    );
    await vi.waitFor(() => expect(built.menu).not.toBeNull());
    const push = itemWithId(menuNamed("Repository"), "sync.push");
    expect(push.enabled).toBe(false);

    rerender(
      <>
        <AppMenu />
        <OfferPush enabled />
      </>,
    );
    await vi.waitFor(() => expect(push.setEnabled).toHaveBeenLastCalledWith(true));
  });

  it("enables a command offered while the menu was being set up", async () => {
    let install = () => {};
    built.installed = new Promise((resolve) => (install = resolve));
    const { rerender } = render(<AppMenu />);
    await vi.waitFor(() => expect(built.menu).not.toBeNull());
    const push = itemWithId(menuNamed("Repository"), "sync.push");
    expect(push.enabled).toBe(false);

    // A screen offers it after the item was made, before the menu is up.
    rerender(
      <>
        <AppMenu />
        <OfferPush enabled />
      </>,
    );
    install();
    await vi.waitFor(() => expect(push.setEnabled).toHaveBeenLastCalledWith(true));
  });
});

describe("help commands", () => {
  it("lists keyboard shortcuts", async () => {
    const user = userEvent.setup();
    renderWithQuery(<HelpCommands />);
    act(() => void runCommand("help.shortcuts"));
    const dialog = await screen.findByRole("dialog", { name: "Keyboard shortcuts" });
    expect(within(dialog).getByText("Push")).toBeVisible();
    expect(within(dialog).getByText("Ctrl+Shift+P")).toBeVisible();
    expect(within(dialog).getByText("Commit")).toBeVisible();
    await user.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("command list", () => {
  it("offers only the commands a screen provides, with shortcuts", async () => {
    const user = userEvent.setup();
    const reveal = vi.fn();
    function Offer() {
      useCommand("repo.reveal", reveal);
      return <CommandList ids={["repo.openEditor", "repo.reveal"]} />;
    }
    renderWithQuery(<Offer />);
    const button = await screen.findByRole("button", { name: /Show in file manager/ });
    expect(button).toHaveTextContent("Ctrl+Shift+F");
    expect(screen.queryByRole("button", { name: /Open in Editor/ })).toBeNull();
    await user.click(button);
    expect(reveal).toHaveBeenCalled();
  });
});

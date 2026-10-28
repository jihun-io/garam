import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";

import { commands } from "../../ipc";
import { useNotify } from "../../features/notify/notifyStore";
import { MenuButton } from "./MenuButton";
import { ContextMenu, openListContextMenu } from "./ContextMenu";
import { Tooltip, TooltipProvider } from "./Tooltip";
import { FileList } from "../../features/changes/FileList";
import { IconButton } from "./IconButton";

type NativeItem = {
  id?: string;
  text?: string;
  enabled?: boolean;
  checked?: boolean;
  items?: NativeItem[];
  action?: () => void;
  item?: string;
};
const native = vi.hoisted(() => ({
  menus: [] as {
    items: NativeItem[];
    close: ReturnType<typeof vi.fn>;
    rid: number;
  }[],
  create: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", async (original) => ({
  ...(await original<typeof import("@tauri-apps/api/core")>()),
  isTauri: () => true,
}));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ label: "repo-1" }) }));
vi.mock("@tauri-apps/api/menu", () => ({ Menu: { new: native.create } }));
vi.mock("../../ipc/bindings", () => ({
  commands: { contextMenuPopup: vi.fn(), externalReveal: vi.fn() },
}));

async function shown(index = 0) {
  await waitFor(() => expect(commands.contextMenuPopup).toHaveBeenCalledTimes(index + 1));
  return native.menus[index];
}

beforeEach(() => {
  fireEvent.pointerDown(document);
  vi.clearAllMocks();
  native.menus = [];
  native.create.mockImplementation(async (options) => {
    const menu = { ...options, rid: native.menus.length + 1, close: vi.fn(async () => {}) };
    native.menus.push(menu);
    return menu;
  });
  vi.mocked(commands.contextMenuPopup).mockResolvedValue({ status: "ok", data: null });
  useNotify.getState().dismiss();
});

describe("native context menus", () => {
  it("removes tooltips before the OS popup and resumes them on fresh web input", async () => {
    const user = userEvent.setup();
    render(
      <TooltipProvider>
        <ContextMenu items={[{ label: "Copy", action: vi.fn() }]}>
          <IconButton label="Source tooltip" icon="openIn" />
        </ContextMenu>
        <Tooltip content="Other tooltip">
          <button>Other</button>
        </Tooltip>
      </TooltipProvider>,
    );
    await user.tab();
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Source tooltip");
    vi.mocked(commands.contextMenuPopup).mockImplementationOnce(async () => {
      expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
      return { status: "ok", data: null };
    });
    fireEvent.contextMenu(screen.getByRole("button", { name: "Source tooltip" }));
    await shown();
    // A native popup may resolve while still tracking, and focus may return
    // without pointer input. Neither should revive the tooltip behind it.
    act(() => screen.getByRole("button", { name: "Other" }).focus());
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    await user.tab({ shift: true });
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Source tooltip");
  });

  it("uses native commands, keeps handlers after showing and releases the previous menu", async () => {
    const action = vi.fn();
    const { unmount } = render(
      <ContextMenu
        items={[
          "separator",
          false,
          { label: "Copy & keep", action },
          "separator",
          "separator",
          { label: "Unavailable", disabled: true, action },
          "separator",
        ]}
      >
        <button>Source</button>
      </ContextMenu>,
    );
    const source = screen.getByRole("button");
    fireEvent.contextMenu(source, { clientX: 35, clientY: 47 });
    const first = await shown();
    expect(commands.contextMenuPopup).toHaveBeenLastCalledWith(first.rid, 35, 47);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(first.items.map((item) => item.text ?? item.item)).toEqual([
      "Copy && keep",
      "Separator",
      "Unavailable",
    ]);
    expect(first.items[2].enabled).toBe(false);
    expect(first.close).not.toHaveBeenCalled();
    await act(async () => first.items[0].action!());
    expect(action).toHaveBeenCalledTimes(1);
    expect(source).toHaveFocus();
    first.items[2].action!();
    expect(action).toHaveBeenCalledTimes(1);

    fireEvent.contextMenu(source);
    const second = await shown(1);
    expect(first.close).toHaveBeenCalledOnce();
    expect(second.items[0].id).toBe(first.items[0].id);
    first.items[0].action!();
    expect(action).toHaveBeenCalledTimes(1);
    unmount();
    await waitFor(() => expect(second.close).toHaveBeenCalledOnce());
    second.items[0].action!();
    expect(action).toHaveBeenCalledTimes(1);
  });

  it("does not show a menu whose source unmounted during creation", async () => {
    let finish!: (menu: unknown) => void;
    native.create.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const { unmount } = render(
      <ContextMenu items={[{ label: "Copy", action: vi.fn() }]}>
        <button>Source</button>
      </ContextMenu>,
    );
    fireEvent.contextMenu(screen.getByRole("button"));
    await waitFor(() => expect(native.create).toHaveBeenCalledOnce());
    unmount();
    const close = vi.fn(async () => {});
    await act(async () => finish({ rid: 1, close }));
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
    expect(commands.contextMenuPopup).not.toHaveBeenCalled();
  });

  it("opens from the focused list option with Shift+F10 and ignores IME composition", async () => {
    render(
      <div role="listbox" tabIndex={0} onKeyDown={(event) => openListContextMenu(event, "option")}>
        <ContextMenu items={[{ label: "Copy", action: vi.fn() }]}>
          <div id="option" role="option" aria-selected>
            Source
          </div>
        </ContextMenu>
      </div>,
    );
    const list = screen.getByRole("listbox");
    list.focus();
    fireEvent.keyDown(list, { key: "F10", shiftKey: true, isComposing: true });
    expect(native.create).not.toHaveBeenCalled();
    fireEvent.keyDown(list, { key: "F10", shiftKey: true });
    await shown();
    expect(list).toHaveFocus();
  });

  it("opens a focused button with the context-menu key", async () => {
    render(
      <ContextMenu items={[{ label: "Copy", action: vi.fn() }]}>
        <button>Source</button>
      </ContextMenu>,
    );
    const source = screen.getByRole("button");
    source.focus();
    fireEvent.keyDown(source, { key: "ContextMenu" });
    await shown();
    expect(source).toHaveFocus();
  });

  it("reports popup failures and releases the failed menu", async () => {
    const error = { kind: "menu_failed", params: {}, detail: "popup failed" } as const;
    vi.mocked(commands.contextMenuPopup).mockResolvedValueOnce({ status: "error", error });
    render(
      <ContextMenu items={[{ label: "Copy", action: vi.fn() }]}>
        <button>Source</button>
      </ContextMenu>,
    );
    fireEvent.contextMenu(screen.getByRole("button"));
    const menu = await shown();
    await waitFor(() => expect(menu.close).toHaveBeenCalledOnce());
    expect(useNotify.getState().notice).toEqual({ type: "error", error });
  });

  it("keeps multi-file actions and never discards without invoking the confirmation callback", async () => {
    const files = ["a.txt", "b.txt"].map((path) => ({
      path,
      origPath: null,
      staged: null,
      unstaged: "modified" as const,
      isSubmodule: false,
    }));
    const onDiscard = vi.fn();
    render(
      <TooltipProvider>
        <FileList
          repo="/repo"
          files={files}
          selection={{ keys: ["a.txt", "b.txt"], focus: "b.txt", anchor: "a.txt" }}
          onSelect={vi.fn()}
          onSelectAll={vi.fn()}
          onMove={vi.fn()}
          onToggle={vi.fn()}
          onDiscard={onDiscard}
        />
      </TooltipProvider>,
    );
    fireEvent.contextMenu(screen.getByRole("option", { name: /b\.txt/ }));
    const menu = await shown();
    expect(menu.items[0].text).toBe("Discard changes to 2 files…");
    expect(onDiscard).not.toHaveBeenCalled();
    await act(async () => menu.items[0].action!());
    expect(onDiscard).toHaveBeenCalledWith(files);
    expect(screen.getByRole("listbox")).toHaveFocus();
  });
});

describe("native menu buttons", () => {
  it("does not reopen a hovered tooltip while a mouse click prepares the native menu", async () => {
    const user = userEvent.setup();
    let finish!: () => void;
    const waiting = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const create = native.create.getMockImplementation()!;
    native.create.mockImplementationOnce(async (options) => {
      await waiting;
      return create(options);
    });
    render(
      <TooltipProvider>
        <MenuButton items={[{ label: "Show in Finder", action: vi.fn() }]}>
          <IconButton label="Open in" icon="openIn" />
        </MenuButton>
      </TooltipProvider>,
    );
    const button = screen.getByRole("button", { name: "Open in" });
    await user.hover(button);
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Open in");
    expect(button).not.toHaveFocus();
    try {
      // WebKit leaves the button unfocused on pointerdown. Our click handler
      // focuses it after pointerup, when Radix permits focus tooltips again.
      fireEvent.pointerDown(button, { pointerType: "mouse" });
      fireEvent.pointerUp(button, { pointerType: "mouse" });
      expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
      fireEvent.click(button);
      expect(button).toHaveFocus();
      expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
      await waitFor(() => expect(native.create).toHaveBeenCalledOnce());
      expect(commands.contextMenuPopup).not.toHaveBeenCalled();
      expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    } finally {
      await act(async () => finish());
    }
    await shown();
  });

  it("forwards tooltip focus and hover handlers to the menu button", async () => {
    const user = userEvent.setup();
    render(
      <TooltipProvider>
        <Tooltip content="Sync actions tooltip">
          <MenuButton items={[{ label: "Fetch", action: vi.fn() }]}>
            <button>Sync actions</button>
          </MenuButton>
        </Tooltip>
      </TooltipProvider>,
    );
    await user.tab();
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Sync actions tooltip");
    expect(screen.getByRole("button")).toHaveAttribute("aria-describedby");
    fireEvent.keyDown(screen.getByRole("button"), { key: "ArrowDown" });
    await shown();
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("anchors below the button and supports arrow-key opening without IME interference", async () => {
    render(
      <MenuButton items={[{ label: "Fetch", action: vi.fn() }]}>
        <button>Sync actions</button>
      </MenuButton>,
    );
    const button = screen.getByRole("button");
    vi.spyOn(button, "getBoundingClientRect").mockReturnValue(new DOMRect(20, 40, 80, 28));
    button.focus();
    fireEvent.keyDown(button, { key: "ArrowDown", isComposing: true });
    expect(native.create).not.toHaveBeenCalled();
    fireEvent.keyDown(button, { key: "ArrowDown" });
    const menu = await shown();
    expect(commands.contextMenuPopup).toHaveBeenCalledWith(menu.rid, 20, 72);
    expect(button).toHaveAttribute("aria-haspopup", "menu");
    expect(button).toHaveFocus();
  });

  it("keeps disabled buttons from opening native menus", async () => {
    render(
      <MenuButton disabled items={[{ label: "Discard", action: vi.fn() }]}>
        <button>More</button>
      </MenuButton>,
    );
    const button = screen.getByRole("button");
    expect(button).toBeDisabled();
    fireEvent.click(button);
    fireEvent.keyDown(button, { key: "ArrowDown" });
    await act(async () => {});
    expect(native.create).not.toHaveBeenCalled();
  });

  it("preserves headings, nested checked choices and their action targets", async () => {
    const choose = vi.fn();
    render(
      <MenuButton
        items={[
          {
            kind: "group",
            label: "Suited & installed",
            items: [{ label: "Open in Xcode", action: vi.fn() }],
          },
          "separator",
          {
            label: "Default editor",
            items: [
              { label: "Follow settings", checked: true, action: () => choose(null) },
              { label: "Xcode", checked: false, action: () => choose("xcode") },
            ],
          },
        ]}
      >
        <button>Editors</button>
      </MenuButton>,
    );
    fireEvent.click(screen.getByRole("button"));
    const menu = await shown();
    expect(menu.items[0]).toMatchObject({ text: "Suited && installed", enabled: false });
    const choices = menu.items.find((item) => item.text === "Default editor")!.items!;
    expect(choices[0]).toMatchObject({ text: "Follow settings", checked: true });
    expect(choices[1]).toMatchObject({ text: "Xcode", checked: false });
    expect(new Set([menu.items[1].id, choices[0].id, choices[1].id]).size).toBe(3);
    await act(async () => choices[1].action!());
    expect(choose).toHaveBeenCalledWith("xcode");
  });
});

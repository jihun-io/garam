import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { commands } from "../../ipc";
import { useNotify } from "../../features/notify/notifyStore";
import { ContextMenu, openListContextMenu } from "./ContextMenu";
import { TooltipProvider } from "./Tooltip";
import { FileList } from "../../features/changes/FileList";

const native = vi.hoisted(() => ({
  menus: [] as {
    items: { id?: string; text?: string; enabled?: boolean; action?: () => void; item?: string }[];
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

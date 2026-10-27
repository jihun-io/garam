import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { commands, type UpdateProgress, type UpdateStatus } from "../../ipc";
import { runCommand } from "../../lib/commands";
import { renderWithQuery } from "../../test/renderWithQuery";
import { Notifications } from "../notify/Notifications";
import { useNotify } from "../notify/notifyStore";
import { UpdateCommands, UpdateNotice } from "./UpdateNotice";

const channels: { onmessage: (p: UpdateProgress) => void }[] = [];
const listeners: ((e: { payload: UpdateStatus }) => void)[] = [];
const identity = vi.hoisted(() => ({ isDevelopmentApp: false }));
vi.mock("../../lib/appIdentity", () => identity);

vi.mock("@tauri-apps/api/core", () => ({
  Channel: class {
    onmessage: (p: UpdateProgress) => void = () => {};
    constructor() {
      channels.push(this);
    }
  },
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (_event: string, fn: (e: { payload: UpdateStatus }) => void) => {
    listeners.push(fn);
    return () => {};
  }),
}));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: vi.fn(async () => "0.1.0") }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn(async () => {}) }));
vi.mock("../../ipc/bindings", () => ({
  commands: {
    updateStatus: vi.fn(),
    updateCheck: vi.fn(),
    updateDismiss: vi.fn(),
    updateInstall: vi.fn(),
    appRestart: vi.fn(),
  },
}));

const ok = <T,>(data: T) => ({ status: "ok" as const, data });
const available: UpdateStatus = {
  available: { version: "0.2.0", currentVersion: "0.1.0" },
  installing: false,
  installed: false,
};

/** What Rust emits to every window when the update state changes. */
async function emit(status: UpdateStatus) {
  await act(async () => {
    listeners.forEach((fn) => fn({ payload: status }));
    // React Query tells its observers on a timer, not a microtask.
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function render(status: UpdateStatus) {
  vi.mocked(commands.updateStatus).mockResolvedValue(status);
  return renderWithQuery(
    <>
      <UpdateCommands />
      <Notifications>
        <UpdateNotice />
      </Notifications>
    </>,
  );
}

describe("update notice", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    channels.length = 0;
    listeners.length = 0;
    useNotify.setState({ notice: null });
    identity.isDevelopmentApp = false;
  });

  it("does not offer release updates in the development app", async () => {
    identity.isDevelopmentApp = true;
    render({ available: null, installing: false, installed: false });
    await act(async () => {});
    expect(runCommand("app.checkUpdates")).toBe(false);
    expect(commands.updateCheck).not.toHaveBeenCalled();
  });

  it("shows nothing without an update", async () => {
    render({ available: null, installing: false, installed: false });
    await act(async () => {});
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("installs with progress and then offers a restart", async () => {
    const user = userEvent.setup();
    let finish: () => void = () => {};
    vi.mocked(commands.updateInstall).mockImplementation(
      () => new Promise((resolve) => (finish = () => resolve(ok(null)))),
    );
    render(available);
    expect(await screen.findByText("Garam 0.2.0 is available.")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Update" }));
    await emit({ ...available, installing: true });
    act(() => channels[0].onmessage({ downloaded: 512, total: 1024 }));
    expect(screen.getByText("Downloading the update… 50%")).toBeVisible();

    await emit({ ...available, installed: true });
    await act(async () => finish());
    await user.click(screen.getByRole("button", { name: "Restart Now" }));
    expect(commands.appRestart).toHaveBeenCalled();
  });

  it("puts the update off until a newer one", async () => {
    const user = userEvent.setup();
    render(available);
    await user.click(await screen.findByRole("button", { name: "Later" }));
    expect(commands.updateDismiss).toHaveBeenCalled();
    await emit({ ...available, available: null });
    expect(screen.queryByText("Garam 0.2.0 is available.")).toBeNull();
  });

  it("says so when the menu finds no newer version", async () => {
    vi.mocked(commands.updateCheck).mockResolvedValue(ok(null));
    render({ available: null, installing: false, installed: false });
    await act(async () => {});
    await act(async () => {
      runCommand("app.checkUpdates");
    });
    expect(await screen.findByText("Garam 0.1.0 is the latest version.")).toBeVisible();
  });

  it("reports a failed install and offers the update again", async () => {
    const user = userEvent.setup();
    vi.mocked(commands.updateInstall).mockResolvedValue({
      status: "error",
      error: { kind: "update_install_failed", params: {}, detail: "bad signature" },
    });
    render(available);
    await user.click(await screen.findByRole("button", { name: "Update" }));
    expect(await screen.findByText(/Couldn't install the update/)).toBeVisible();
    expect(screen.getByRole("button", { name: "Update" })).toBeVisible();
  });
});

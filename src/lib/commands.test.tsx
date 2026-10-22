import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { formatShortcut, isCommandEnabled, runCommand, useCommand } from "./commands";

function Offer({ run, enabled }: { run: () => void; enabled?: boolean }) {
  useCommand("sync.push", run, enabled);
  return null;
}

describe("commands", () => {
  it("runs only while a screen offers the command", () => {
    const run = vi.fn();
    expect(runCommand("sync.push")).toBe(false);

    const { rerender, unmount } = render(<Offer run={run} enabled={false} />);
    expect(isCommandEnabled("sync.push")).toBe(false);
    expect(runCommand("sync.push")).toBe(false);

    rerender(<Offer run={run} enabled />);
    expect(isCommandEnabled("sync.push")).toBe(true);
    expect(runCommand("sync.push")).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);

    unmount();
    expect(isCommandEnabled("sync.push")).toBe(false);
  });

  it("uses the latest registration", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { unmount } = render(
      <>
        <Offer run={first} />
        <Offer run={second} />
      </>,
    );
    runCommand("sync.push");
    expect(second).toHaveBeenCalled();
    expect(first).not.toHaveBeenCalled();
    unmount();
  });

  it("formats shortcuts per platform", () => {
    expect(formatShortcut("CmdOrCtrl+Shift+P", "macos")).toBe("⇧⌘P");
    expect(formatShortcut("CmdOrCtrl+Shift+P", "windows")).toBe("Ctrl+Shift+P");
    expect(formatShortcut("Ctrl+`", "macos")).toBe("⌃`");
    expect(formatShortcut("CmdOrCtrl+,", "linux")).toBe("Ctrl+,");
    expect(formatShortcut("CmdOrCtrl+Enter", "macos")).toBe("⌘↩");
    expect(formatShortcut("CmdOrCtrl+Backspace", "windows")).toBe("Ctrl+Backspace");
  });
});

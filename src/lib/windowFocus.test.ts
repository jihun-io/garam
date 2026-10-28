import { getCurrentWindow } from "@tauri-apps/api/window";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { initWindowFocus } from "./windowFocus";

vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: vi.fn() }));
let stop: (() => void) | undefined;
let changed: (event: { payload: boolean }) => void;
const unlisten = vi.fn();
const isFocused = vi.fn(async () => true);

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
  vi.mocked(getCurrentWindow).mockReturnValue({
    isFocused,
    onFocusChanged: vi.fn(async (listener) => {
      changed = listener;
      return unlisten;
    }),
  } as unknown as ReturnType<typeof getCurrentWindow>);
  isFocused.mockResolvedValue(true);
});
afterEach(() => {
  stop?.();
  stop = undefined;
  vi.restoreAllMocks();
});

const focused = () => document.documentElement.dataset.windowFocused;

describe("window selection focus", () => {
  it("follows the native window instead of focus moving between controls", async () => {
    stop = initWindowFocus();
    await vi.waitFor(() => expect(focused()).toBe("true"));
    // Even a bubbling control blur must not be mistaken for a window blur.
    const input = document.createElement("input");
    document.body.append(input);
    input.dispatchEvent(new FocusEvent("blur", { bubbles: true }));
    input.remove();
    expect(focused()).toBe("true");
    changed({ payload: false });
    expect(focused()).toBe("false");
    changed({ payload: true });
    expect(focused()).toBe("true");
    stop();
    expect(unlisten).toHaveBeenCalledOnce();
    expect(focused()).toBeUndefined();
    stop = undefined;
  });

  it("deactivates when the webview blurs before the native focus state changes", async () => {
    stop = initWindowFocus();
    await vi.waitFor(() => expect(isFocused).toHaveBeenCalledOnce());
    window.dispatchEvent(new FocusEvent("blur"));
    expect(focused()).toBe("false");
    // A native key-window event alone cannot reactivate an inactive app.
    changed({ payload: true });
    expect(focused()).toBe("false");
    window.dispatchEvent(new FocusEvent("focus"));
    expect(focused()).toBe("true");
    changed({ payload: false });
    // Webview focus cannot override another native window becoming key.
    window.dispatchEvent(new FocusEvent("focus"));
    expect(focused()).toBe("false");
  });

  it("does not let a delayed native snapshot reactivate a blurred webview", async () => {
    let resolve!: (value: boolean) => void;
    isFocused.mockReturnValueOnce(new Promise((done) => (resolve = done)));
    stop = initWindowFocus();
    await vi.waitFor(() => expect(isFocused).toHaveBeenCalledOnce());
    window.dispatchEvent(new FocusEvent("blur"));
    resolve(true);
    await Promise.resolve();
    expect(focused()).toBe("false");
    window.dispatchEvent(new FocusEvent("focus"));
    expect(focused()).toBe("true");
  });

  it("keeps following webview activation if native subscription fails", async () => {
    vi.mocked(getCurrentWindow).mockReturnValue({
      onFocusChanged: vi.fn().mockRejectedValue(new Error("unavailable")),
    } as unknown as ReturnType<typeof getCurrentWindow>);
    stop = initWindowFocus();
    await Promise.resolve();
    window.dispatchEvent(new FocusEvent("blur"));
    expect(focused()).toBe("false");
    window.dispatchEvent(new FocusEvent("focus"));
    expect(focused()).toBe("true");
    stop();
    stop = undefined;
    window.dispatchEvent(new FocusEvent("blur"));
    expect(focused()).toBeUndefined();
  });

  it("does not replace a newer focus event with a delayed initial snapshot", async () => {
    let resolve!: (value: boolean) => void;
    isFocused.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    stop = initWindowFocus();
    await vi.waitFor(() => expect(isFocused).toHaveBeenCalledOnce());
    changed({ payload: false });
    resolve(true);
    await Promise.resolve();
    expect(focused()).toBe("false");
  });

  it("releases a subscription that arrives after disposal", async () => {
    let subscribed!: (value: () => void) => void;
    vi.mocked(getCurrentWindow).mockReturnValue({
      onFocusChanged: vi.fn(
        () =>
          new Promise((done) => {
            subscribed = done;
          }),
      ),
      isFocused,
    } as unknown as ReturnType<typeof getCurrentWindow>);
    stop = initWindowFocus();
    stop();
    stop = undefined;
    subscribed(unlisten);
    await vi.waitFor(() => expect(unlisten).toHaveBeenCalledOnce());
    expect(isFocused).not.toHaveBeenCalled();
    expect(focused()).toBeUndefined();
  });

  it("uses browser focus and removes listeners in previews", () => {
    vi.mocked(getCurrentWindow).mockImplementation(() => {
      throw new Error("browser");
    });
    stop = initWindowFocus();
    window.dispatchEvent(new Event("focus"));
    expect(focused()).toBe("true");
    window.dispatchEvent(new Event("blur"));
    expect(focused()).toBe("false");
    stop();
    stop = undefined;
    window.dispatchEvent(new Event("focus"));
    expect(focused()).toBeUndefined();
  });
});

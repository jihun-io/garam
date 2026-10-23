import { afterEach, describe, expect, it, vi } from "vitest";

import { installLayerScrollBounce } from "./scrollBounce";

describe("installLayerScrollBounce", () => {
  let uninstall = () => {};
  afterEach(() => {
    uninstall();
    document.body.innerHTML = "";
  });

  it("keeps wheel events from inside a dialog away from the scroll lock", () => {
    document.body.innerHTML = '<div role="dialog"><div id="list"></div></div><div id="page"></div>';
    uninstall = installLayerScrollBounce();
    const lock = vi.fn();
    document.addEventListener("wheel", lock);

    document.getElementById("list")!.dispatchEvent(new WheelEvent("wheel", { bubbles: true }));
    expect(lock).not.toHaveBeenCalled();

    // The background stays locked.
    document.getElementById("page")!.dispatchEvent(new WheelEvent("wheel", { bubbles: true }));
    expect(lock).toHaveBeenCalledTimes(1);
    document.removeEventListener("wheel", lock);
  });

  it("makes wheel listeners on the document passive, so they can't cancel scrolling", () => {
    document.body.innerHTML = '<div id="list"></div>';
    uninstall = installLayerScrollBounce();
    const cancel = (e: Event) => e.preventDefault();
    document.addEventListener("wheel", cancel, { passive: false });

    const event = new WheelEvent("wheel", { bubbles: true, cancelable: true });
    document.getElementById("list")!.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    document.removeEventListener("wheel", cancel);
  });
});

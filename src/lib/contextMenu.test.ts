import { afterEach, describe, expect, it } from "vitest";

import { installContextMenuGuard } from "./contextMenu";

function rightClick(target: Element): boolean {
  const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event.defaultPrevented;
}

describe("native context menu", () => {
  installContextMenuGuard();

  afterEach(() => {
    window.getSelection()?.removeAllRanges();
    document.body.innerHTML = "";
  });

  it("is hidden on ordinary UI", () => {
    document.body.innerHTML = `<button>Push</button>`;
    expect(rightClick(document.querySelector("button")!)).toBe(true);
  });

  it("stays in text fields", () => {
    document.body.innerHTML = `<input /><textarea></textarea>`;
    expect(rightClick(document.querySelector("input")!)).toBe(false);
    expect(rightClick(document.querySelector("textarea")!)).toBe(false);
  });

  it("stays over selected text", () => {
    document.body.innerHTML = `<p id="diff">const a = 1;</p><p id="other">elsewhere</p>`;
    const diff = document.getElementById("diff")!;
    window.getSelection()!.selectAllChildren(diff);
    expect(rightClick(diff)).toBe(false);
    expect(rightClick(document.getElementById("other")!)).toBe(true);
  });

  it("leaves menus a screen handles alone", () => {
    document.body.innerHTML = `<div>file</div>`;
    const row = document.querySelector("div")!;
    row.addEventListener("contextmenu", (e) => e.preventDefault());
    expect(rightClick(row)).toBe(true);
  });
});

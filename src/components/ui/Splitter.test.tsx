import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Splitter } from "./Splitter";

function renderSplitter(value = 300) {
  const onPreview = vi.fn();
  const onCommit = vi.fn();
  render(
    <div>
      <Splitter
        value={value}
        min={240}
        max={() => 600}
        defaultValue={320}
        clamp={(w) => Math.min(600, Math.max(240, w))}
        onPreview={onPreview}
        onCommit={onCommit}
        label="Resize sidebar"
      />
    </div>,
  );
  return { onPreview, onCommit, handle: screen.getByRole("separator", { name: "Resize sidebar" }) };
}

describe("Splitter", () => {
  it("steps with arrow keys within the limits", async () => {
    const user = userEvent.setup();
    const { onCommit, handle } = renderSplitter(250);
    expect(handle).toHaveAttribute("aria-valuenow", "250");
    handle.focus();
    await user.keyboard("{ArrowRight}");
    expect(onCommit).toHaveBeenLastCalledWith(266);
    await user.keyboard("{ArrowLeft}");
    expect(onCommit).toHaveBeenLastCalledWith(240);
  });

  it("previews while dragging and saves on release", () => {
    const { onPreview, onCommit, handle } = renderSplitter(300);
    // jsdom lays nothing out, so the drag starts from the saved value.
    fireEvent.pointerDown(handle, { button: 0, clientX: 300, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 360, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 2000, pointerId: 1 });
    expect(onPreview).toHaveBeenLastCalledWith(600);
    expect(onCommit).not.toHaveBeenCalled();
    fireEvent.pointerUp(handle, { pointerId: 1 });
    expect(onCommit).toHaveBeenCalledWith(600);
  });

  it("resets on double-click", async () => {
    const user = userEvent.setup();
    const { onCommit, handle } = renderSplitter(500);
    await user.dblClick(handle);
    expect(onCommit).toHaveBeenLastCalledWith(320);
  });
});

import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { FormDialog } from "./Dialog";

function renderDialog() {
  const onOpenChange = vi.fn();
  render(
    <FormDialog
      open
      onOpenChange={onOpenChange}
      title="Example"
      onSubmit={() => {}}
      footer={<button type="submit">OK</button>}
    >
      <p>Body</p>
    </FormDialog>,
  );
  return onOpenChange;
}

// Radix starts listening for outside clicks one tick after opening.
const listening = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));

describe("FormDialog", () => {
  it("stays open when the window is dragged from above the backdrop", async () => {
    const onOpenChange = renderDialog();
    await listening();
    const dragArea = document.querySelector("[data-tauri-drag-region]")!;
    expect(dragArea).not.toBeNull();
    fireEvent.pointerDown(dragArea);
    fireEvent.click(dragArea);
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Example" })).toBeVisible();
  });

  it("still closes when clicking elsewhere outside", async () => {
    const onOpenChange = renderDialog();
    await listening();
    // jsdom's pointer events have no pointerType, so Radix waits for the
    // click that follows, as it does for touch.
    fireEvent.pointerDown(document.body);
    fireEvent.click(document.body);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

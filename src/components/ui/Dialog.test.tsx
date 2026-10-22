import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DropdownMenu } from "radix-ui";
import { useState } from "react";
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

  it("returns focus to the menu's button after opening from a menu item", async () => {
    const user = userEvent.setup();
    function FromMenu() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <DropdownMenu.Root>
            <DropdownMenu.Trigger>More</DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content>
                <DropdownMenu.Item onSelect={() => setOpen(true)}>Discard…</DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
          {open && (
            <FormDialog
              open
              onOpenChange={setOpen}
              title="Discard?"
              onSubmit={() => {}}
              footer={<button type="submit">OK</button>}
            >
              <p>Body</p>
            </FormDialog>
          )}
        </>
      );
    }
    render(<FromMenu />);
    const more = screen.getByRole("button", { name: "More" });
    more.focus();
    await user.keyboard("{Enter}");
    await user.click(await screen.findByRole("menuitem", { name: "Discard…" }));
    await screen.findByRole("dialog", { name: "Discard?" });
    await user.keyboard("{Escape}");
    await waitFor(() => expect(more).toHaveFocus());
  });
});

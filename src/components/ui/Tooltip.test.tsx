import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { Icon } from "../Icon";
import { Tooltip, TooltipProvider } from "./Tooltip";

describe("Tooltip", () => {
  it("shows on keyboard focus, not only on hover", async () => {
    const user = userEvent.setup();
    render(
      <TooltipProvider>
        <Tooltip content="Dismiss">
          <button type="button" aria-label="Dismiss">
            <Icon name="close" />
          </button>
        </Tooltip>
      </TooltipProvider>,
    );
    expect(screen.queryByRole("tooltip")).toBeNull();
    await user.tab();
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Dismiss");
  });
});

describe("Tooltip whenTruncated", () => {
  // jsdom has no layout; give the trigger the widths a browser would.
  const sized = (scrollWidth: number) => (el: HTMLElement | null) => {
    if (!el) return;
    Object.defineProperty(el, "scrollWidth", { configurable: true, value: scrollWidth });
    Object.defineProperty(el, "clientWidth", { configurable: true, value: 100 });
  };
  const renderPath = (scrollWidth: number) => {
    render(
      <TooltipProvider>
        <Tooltip content="src/features/changes/FileList.tsx" whenTruncated>
          <span tabIndex={0} ref={sized(scrollWidth)}>
            src/features/…
          </span>
        </Tooltip>
      </TooltipProvider>,
    );
  };

  it("reveals cut-off text", async () => {
    const user = userEvent.setup();
    renderPath(240);
    await user.tab();
    expect(await screen.findByRole("tooltip")).toHaveTextContent("FileList.tsx");
  });

  it("stays hidden when everything fits", async () => {
    const user = userEvent.setup();
    renderPath(80);
    await user.tab();
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole("tooltip")).toBeNull();
  });
});

describe("Icon", () => {
  it("is hidden from screen readers unless labelled", () => {
    const { container } = render(
      <>
        <Icon name="branch" />
        <Icon name="conflicted" label="Conflicted" />
      </>,
    );
    const [decorative, labelled] = container.querySelectorAll("svg");
    expect(decorative).toHaveAttribute("aria-hidden", "true");
    expect(labelled).not.toHaveAttribute("aria-hidden");
    expect(screen.getByRole("img", { name: "Conflicted" })).toBe(labelled);
  });
});

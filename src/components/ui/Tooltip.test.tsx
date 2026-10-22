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

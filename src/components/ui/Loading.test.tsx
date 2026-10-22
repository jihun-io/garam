import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LOADING_DELAY_MS, Loading } from "./Loading";

describe("Loading", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("stays blank for quick loads, then shows a label", () => {
    render(<Loading />);
    const status = screen.getByRole("status");
    expect(status).toBeEmptyDOMElement();

    act(() => vi.advanceTimersByTime(LOADING_DELAY_MS));
    expect(status).toHaveTextContent("Loading…");
  });
});

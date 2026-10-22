import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithQuery } from "../../test/renderWithQuery";
import { Notifications } from "./Notifications";
import { useNotify } from "./notifyStore";

describe("notifications", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useNotify.setState({ notice: null });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps an info notice while the pointer is on it", () => {
    renderWithQuery(<Notifications />);
    act(() => useNotify.getState().showInfo("Copied a1b2c3d."));
    const notice = screen.getByText("Copied a1b2c3d.");

    fireEvent.mouseEnter(notice);
    act(() => vi.advanceTimersByTime(10_000));
    expect(screen.getByText("Copied a1b2c3d.")).toBeVisible();

    fireEvent.mouseLeave(notice);
    act(() => vi.advanceTimersByTime(10_000));
    expect(screen.queryByText("Copied a1b2c3d.")).toBeNull();
  });

  it("keeps errors until dismissed", () => {
    renderWithQuery(<Notifications />);
    act(() => useNotify.getState().showError({ kind: "network_error", params: {}, detail: null }));
    act(() => vi.advanceTimersByTime(10_000));
    expect(screen.getByRole("alert")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

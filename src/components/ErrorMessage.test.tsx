import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import i18n from "../i18n";
import { ErrorMessage } from "./ErrorMessage";

describe("ErrorMessage", () => {
  it("translates the error kind and interpolates params", async () => {
    await i18n.changeLanguage("ko");
    render(
      <ErrorMessage
        error={{
          kind: "git_too_old",
          params: { found: "2.30.0", required: "2.35.0" },
          detail: null,
        }}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Git 2.30.0 버전은 지원하지 않습니다. Git 2.35.0 이상이 필요합니다.",
    );
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("reveals the raw git output on demand", async () => {
    const user = userEvent.setup();
    render(
      <ErrorMessage
        error={{ kind: "not_a_repository", params: {}, detail: "fatal: not a git repository" }}
      />,
    );
    expect(screen.queryByText("fatal: not a git repository")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Show details" }));
    expect(screen.getByText("fatal: not a git repository")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hide details" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });
});

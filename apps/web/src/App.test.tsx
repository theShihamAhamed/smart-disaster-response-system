import { render, screen } from "@testing-library/react";
import type { ReliefRequestDetails } from "@disaster/shared-types";
import { describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { createMockApi } from "./features/relief-allocation/relief-test-fixtures";

describe("District Officer relief application shell", () => {
  it("presents semantic navigation, identity context, and the assessed workflow", async () => {
    render(<App api={createMockApi()} initialPath="/relief" />);

    expect(screen.getByRole("link", { name: "Skip to main content" })).toHaveAttribute(
      "href",
      "#main-content",
    );
    expect(screen.getByRole("navigation", { name: "Officer navigation" })).toBeInTheDocument();
    expect(screen.getByLabelText("Authenticated role")).toHaveTextContent("District Officer");
    expect(
      await screen.findByRole("heading", { name: "Relief allocation", level: 1 }),
    ).toBeInTheDocument();
  });

  it("renders an accessible workspace loading state", () => {
    const api = createMockApi({
      getReliefRequest: vi.fn(() => new Promise<ReliefRequestDetails>(() => undefined)),
    });
    render(<App api={api} initialPath="/relief/70000000-0000-4000-8000-000000000001" />);

    expect(
      screen.getByRole("heading", { name: "Loading allocation workspace" }),
    ).toBeInTheDocument();
  });
});

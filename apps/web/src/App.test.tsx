import { ApiClientError } from "@disaster/api-client";
import type { ReliefRequestDetails } from "@disaster/shared-types";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { createMockApi } from "./features/relief-allocation/relief-test-fixtures";

const requestPath = "/relief/70000000-0000-4000-8000-000000000001";

describe("integrated officer web shell", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/");
  });

  it("shows every implemented module and selects Hazard Verification at the root", () => {
    render(<App initialPath="/" />);

    expect(screen.getByRole("banner")).toBeInTheDocument();
    expect(
      screen.getByRole("navigation", { name: "Officer workspace navigation" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Hazard Verification/i })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: /Broadcast Alert/i })).toHaveAttribute(
      "href",
      "/broadcast",
    );
    expect(screen.getByRole("link", { name: /Resource Allocation/i })).toHaveAttribute(
      "href",
      "/relief",
    );
  });

  it("loads Broadcast Alert from its pathname and marks it active", () => {
    render(<App initialPath="/broadcast" />);

    expect(screen.getByLabelText("Broadcast Hazard Alert Dashboard")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Broadcast Alert/i })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("navigates to Resource Allocation with pushState and keeps one shared shell", async () => {
    render(<App api={createMockApi()} />);

    fireEvent.click(screen.getByRole("link", { name: /Resource Allocation/i }));

    expect(window.location.pathname).toBe("/relief");
    expect(screen.getAllByRole("banner")).toHaveLength(1);
    expect(screen.getByRole("link", { name: /Resource Allocation/i })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(await screen.findByRole("heading", { name: "Shelters needing supply" })).toBeVisible();
  });

  it("responds to browser history events", async () => {
    render(<App api={createMockApi()} />);

    fireEvent.click(screen.getByRole("link", { name: /Broadcast Alert/i }));
    expect(window.location.pathname).toBe("/broadcast");

    window.history.pushState({}, "", "/relief");
    window.dispatchEvent(new PopStateEvent("popstate"));
    await waitFor(() =>
      expect(screen.getByRole("link", { name: /Resource Allocation/i })).toHaveAttribute(
        "aria-current",
        "page",
      ),
    );

    window.history.pushState({}, "", "/broadcast");
    window.dispatchEvent(new PopStateEvent("popstate"));
    await waitFor(() =>
      expect(screen.getByRole("link", { name: /Broadcast Alert/i })).toHaveAttribute(
        "aria-current",
        "page",
      ),
    );
  });
});

describe("District Officer relief routes", () => {
  it("renders the relief queue within the shared application main landmark", async () => {
    render(<App api={createMockApi()} initialPath="/relief" />);

    expect(screen.getByRole("link", { name: "Skip to main content" })).toHaveAttribute(
      "href",
      "#main-content",
    );
    expect(screen.getAllByRole("main")).toHaveLength(1);
    expect(screen.getByLabelText("Required workspace role")).toHaveTextContent("District Officer");
    expect(await screen.findByRole("heading", { name: "Shelters needing supply" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Select a relief request" })).toBeVisible();
  });

  it("renders a direct relief-details route with the shared shell", () => {
    const api = createMockApi({
      getReliefRequest: vi.fn(() => new Promise<ReliefRequestDetails>(() => undefined)),
    });
    render(<App api={api} initialPath={requestPath} />);

    expect(screen.getByRole("banner")).toBeInTheDocument();
    expect(screen.getAllByRole("main")).toHaveLength(1);
    expect(
      screen.getByRole("heading", { name: "Loading allocation workspace" }),
    ).toBeInTheDocument();
  });

  it("keeps a forbidden relief response inside the shell with role guidance", async () => {
    const api = createMockApi({
      listReliefRequests: vi.fn(async () => {
        throw new ApiClientError(403, {
          error: {
            code: "FORBIDDEN",
            message: "Forbidden",
            fieldErrors: {},
            details: {},
          },
        });
      }),
    });

    render(<App api={api} initialPath="/relief" />);

    expect(
      await screen.findByRole("heading", { name: "District Officer access required" }),
    ).toBeVisible();
    expect(screen.getByRole("banner")).toBeInTheDocument();
  });
});

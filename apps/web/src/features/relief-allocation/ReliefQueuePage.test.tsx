import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReliefRequestQueueResponse } from "@disaster/shared-types";
import { describe, expect, it, vi } from "vitest";

import { ReliefAllocationFeature } from "./ReliefAllocationFeature";
import { createMockApi, details, queue } from "./relief-test-fixtures";

describe("ranked relief request queue", () => {
  it("shows an accessible loading state before the queue resolves", () => {
    const api = createMockApi({
      listReliefRequests: vi.fn(() => new Promise<ReliefRequestQueueResponse>(() => undefined)),
    });

    render(<ReliefAllocationFeature api={api} initialPath="/relief" />);

    expect(screen.getByRole("heading", { name: "Loading ranked requests" })).toBeInTheDocument();
    expect(screen.getByText(/checking current shelter needs/i)).toBeInTheDocument();
  });

  it("displays populated requests in the exact server-returned order", async () => {
    render(<ReliefAllocationFeature api={createMockApi()} initialPath="/relief" />);

    const cards = await screen.findAllByRole("article");
    const requestCards = cards.filter((card) => card.classList.contains("request-card"));
    expect(requestCards).toHaveLength(2);
    expect(within(requestCards[0]!).getByText("Kelaniya Central Shelter")).toBeInTheDocument();
    expect(within(requestCards[0]!).getByText("Critical severity")).toBeInTheDocument();
    expect(within(requestCards[0]!).getByText("170/200 (85%)")).toBeInTheDocument();
    expect(within(requestCards[0]!).getByText("60 units")).toBeInTheDocument();
    expect(within(requestCards[1]!).getByText("Biyagama Community Hall")).toBeInTheDocument();
  });

  it("shows a clear empty state", async () => {
    const api = createMockApi({ listReliefRequests: vi.fn(async () => []) });
    render(<ReliefAllocationFeature api={api} initialPath="/relief" />);

    expect(
      await screen.findByRole("heading", { name: "No matching actionable requests" }),
    ).toBeInTheDocument();
  });

  it("shows an API error and retries the queue", async () => {
    const listReliefRequests = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockResolvedValueOnce(queue);
    const api = createMockApi({ listReliefRequests });
    render(<ReliefAllocationFeature api={api} initialPath="/relief" />);

    expect(
      await screen.findByRole("heading", { name: "Relief requests could not be loaded" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry loading" }));

    expect(await screen.findByText("Kelaniya Central Shelter")).toBeInTheDocument();
    expect(listReliefRequests).toHaveBeenCalledTimes(2);
  });

  it("sends the selected frozen filters to the shared client", async () => {
    const api = createMockApi();
    render(<ReliefAllocationFeature api={api} initialPath="/relief" />);
    await screen.findByText("Kelaniya Central Shelter");

    fireEvent.change(screen.getByLabelText("Request status"), {
      target: { value: "PARTIALLY_ALLOCATED" },
    });
    fireEvent.change(screen.getByLabelText("Zone severity"), {
      target: { value: "CRITICAL" },
    });

    await waitFor(() =>
      expect(api.listReliefRequests).toHaveBeenLastCalledWith({
        status: "PARTIALLY_ALLOCATED",
        zoneSeverity: "CRITICAL",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    await waitFor(() => expect(api.listReliefRequests).toHaveBeenLastCalledWith({}));
  });

  it("opens the selected request workspace without re-ranking the queue", async () => {
    const api = createMockApi({ getReliefRequest: vi.fn(async () => details) });
    render(<ReliefAllocationFeature api={api} initialPath="/relief" />);
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Open allocation workspace for Kelaniya Central Shelter",
      }),
    );

    expect(
      await screen.findByRole("heading", { name: "Kelaniya Central Shelter", level: 1 }),
    ).toBeInTheDocument();
    expect(api.getReliefRequest).toHaveBeenCalledWith(queue[0]!.requestId);
  });
});

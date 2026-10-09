import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ReliefAllocationFeature } from "./ReliefAllocationFeature";
import { apiError, createMockApi, ids } from "./relief-test-fixtures";

async function submitWithError(code: string) {
  const api = createMockApi({
    createReliefAllocation: vi.fn(async () => {
      throw apiError(code);
    }),
  });
  render(
    <ReliefAllocationFeature
      api={api}
      initialPath={`/relief/${ids.request}`}
      createIdempotencyKey={() => ids.key}
    />,
  );
  fireEvent.change(await screen.findByLabelText("Allocate Water now"), {
    target: { value: "60" },
  });
  fireEvent.change(screen.getByLabelText("Allocate Medical Kit now"), {
    target: { value: "8" },
  });
  fireEvent.change(screen.getByLabelText("Resupply partner"), {
    target: { value: ids.partner },
  });
  fireEvent.click(screen.getByRole("button", { name: "Review allocation" }));
  fireEvent.click(await screen.findByRole("button", { name: "Confirm allocation" }));
  return api;
}

describe("typed relief allocation conflict UX", () => {
  it.each([
    ["STOCK_CHANGED", "Warehouse stock changed"],
    ["REQUEST_CHANGED", "Relief request changed"],
    ["REQUEST_ALREADY_ALLOCATED", "Request already allocated"],
    ["TEAM_UNAVAILABLE", "Rescue team unavailable"],
    ["PARTNER_REQUIRED", "Partner selection required"],
    ["IDEMPOTENCY_MISMATCH", "Allocation attempt cannot be resumed"],
  ])("maps %s to the professional conflict state", async (code, title) => {
    await submitWithError(code);
    expect(await screen.findByRole("heading", { name: title })).toBeInTheDocument();
  });

  it("reloads changed request data without automatically resubmitting stale intent", async () => {
    const api = await submitWithError("REQUEST_CHANGED");
    await screen.findByRole("heading", { name: "Relief request changed" });
    fireEvent.click(screen.getByRole("button", { name: "Reload latest request" }));

    expect(await screen.findByLabelText("Allocate Water now")).toHaveValue(0);
    expect(api.getReliefRequest).toHaveBeenCalledTimes(2);
    expect(api.createReliefAllocation).toHaveBeenCalledOnce();
  });

  it("returns a partner conflict to the labeled allocation form", async () => {
    await submitWithError("PARTNER_REQUIRED");
    await screen.findByRole("heading", { name: "Partner selection required" });
    fireEvent.click(screen.getByRole("button", { name: "Return to allocation form" }));

    expect(screen.getByLabelText("Allocate Medical Kit now")).toBeInTheDocument();
  });

  it("handles a safe server validation response without exposing internals", async () => {
    const api = createMockApi({
      createReliefAllocation: vi.fn(async () => {
        throw apiError("VALIDATION_ERROR", 422);
      }),
    });
    render(
      <ReliefAllocationFeature
        api={api}
        initialPath={`/relief/${ids.request}`}
        createIdempotencyKey={() => ids.key}
      />,
    );
    fireEvent.change(await screen.findByLabelText("Allocate Water now"), {
      target: { value: "60" },
    });
    fireEvent.change(screen.getByLabelText("Allocate Medical Kit now"), {
      target: { value: "8" },
    });
    fireEvent.change(screen.getByLabelText("Resupply partner"), {
      target: { value: ids.partner },
    });
    fireEvent.click(screen.getByRole("button", { name: "Review allocation" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirm allocation" }));

    expect(
      await screen.findByRole("heading", { name: "Allocation was not accepted" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Safe VALIDATION_ERROR message.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Return to allocation form" }));
    await waitFor(() => expect(screen.getByLabelText("Allocate Water now")).toBeInTheDocument());
  });
});

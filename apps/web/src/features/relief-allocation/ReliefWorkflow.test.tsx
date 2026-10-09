import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ReliefAllocationFeature } from "./ReliefAllocationFeature";
import { apiError, createMockApi, ids, receipt } from "./relief-test-fixtures";

async function prepareConfirmedAllocation(
  api = createMockApi(),
  createIdempotencyKey = vi.fn(() => ids.key),
) {
  render(
    <ReliefAllocationFeature
      api={api}
      initialPath={`/relief/${ids.request}`}
      createIdempotencyKey={createIdempotencyKey}
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
  fireEvent.change(screen.getByLabelText("Available rescue team"), {
    target: { value: ids.team },
  });
  fireEvent.change(screen.getByLabelText("Notes for this allocation"), {
    target: { value: "  Priority medical delivery.  " },
  });
  fireEvent.click(screen.getByRole("button", { name: "Review allocation" }));
  const confirmationHeading = await screen.findByRole("heading", {
    name: "Confirm relief allocation",
  });
  await waitFor(() => expect(confirmationHeading).toHaveFocus());
  return { api, createIdempotencyKey };
}

describe("allocation confirmation and submission", () => {
  it("shows separate warehouse, resupply, rescue, notes, and expected outcome summaries", async () => {
    await prepareConfirmedAllocation();

    expect(screen.getByRole("heading", { name: "Allocate now" })).toBeInTheDocument();
    expect(screen.getByText("12 units requested")).toBeInTheDocument();
    expect(screen.getByText("Gampaha Relief Network")).toBeInTheDocument();
    expect(screen.getByText("Kelani Rescue One")).toBeInTheDocument();
    expect(screen.getByText("Priority medical delivery.")).toBeInTheDocument();
    const outcome = screen
      .getByRole("heading", { name: "Request state preview" })
      .closest("section");
    expect(outcome).not.toBeNull();
    expect(within(outcome!).getByText("Partially Allocated")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm allocation" })).toBeEnabled();
  });

  it("creates one key per logical intent and retains it while an unchanged summary is reviewed", async () => {
    const createKey = vi
      .fn()
      .mockReturnValueOnce(ids.key)
      .mockReturnValueOnce("20000000-0000-4000-8000-000000000002");
    await prepareConfirmedAllocation(createMockApi(), createKey);
    expect(createKey).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: "Edit allocation" }));
    fireEvent.click(screen.getByRole("button", { name: "Review allocation" }));
    expect(createKey).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: "Edit allocation" }));
    fireEvent.change(screen.getByLabelText("Notes for this allocation"), {
      target: { value: "Materially changed notes" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Review allocation" }));
    expect(createKey).toHaveBeenCalledTimes(2);
  });

  it("posts only the frozen command and prevents a double client submission", async () => {
    const createReliefAllocation = vi.fn(async () => receipt);
    const api = createMockApi({ createReliefAllocation });
    await prepareConfirmedAllocation(api);
    const confirm = screen.getByRole("button", { name: "Confirm allocation" });

    fireEvent.click(confirm);
    fireEvent.click(confirm);

    expect(
      await screen.findByRole("heading", { name: "Relief allocation finalized" }),
    ).toBeInTheDocument();
    expect(createReliefAllocation).toHaveBeenCalledOnce();
    expect(createReliefAllocation).toHaveBeenCalledWith(
      ids.request,
      {
        requestVersion: 4,
        items: [
          { requestItemId: ids.water, allocateQty: 60 },
          { requestItemId: ids.medical, allocateQty: 8 },
        ],
        shortages: [{ requestItemId: ids.medical, partnerOrganisationId: ids.partner }],
        rescueTeamId: ids.team,
        notes: "Priority medical delivery.",
      },
      ids.key,
    );
    const submitted = vi.mocked(api.createReliefAllocation).mock.calls[0]?.[1];
    expect(submitted).not.toHaveProperty("officerId");
    expect(submitted).not.toHaveProperty("districtId");
    expect(submitted).not.toHaveProperty("status");
  });

  it("displays the authoritative receipt for a successful new or replayed response", async () => {
    await prepareConfirmedAllocation();
    fireEvent.click(screen.getByRole("button", { name: "Confirm allocation" }));

    const receiptHeading = await screen.findByRole("heading", {
      name: "Relief allocation finalized",
    });
    await waitFor(() => expect(receiptHeading).toHaveFocus());
    expect(screen.getByText(receipt.allocationId)).toBeInTheDocument();
    const authoritativeReceipt = screen.getByLabelText("Allocation receipt");
    expect(within(authoritativeReceipt).getByText("60 units")).toBeInTheDocument();
    expect(within(authoritativeReceipt).getByText("12 units")).toBeInTheDocument();
    expect(within(authoritativeReceipt).getByText("Team en route")).toBeInTheDocument();
  });

  it("recovers an uncertain POST using the same idempotency key", async () => {
    const createReliefAllocation = vi.fn(async () => {
      throw new TypeError("connection interrupted");
    });
    const getReliefAllocationByIdempotencyKey = vi.fn(async () => receipt);
    const api = createMockApi({
      createReliefAllocation,
      getReliefAllocationByIdempotencyKey,
    });
    await prepareConfirmedAllocation(api);
    fireEvent.click(screen.getByRole("button", { name: "Confirm allocation" }));

    expect(await screen.findByText("Existing committed allocation recovered.")).toBeInTheDocument();
    expect(getReliefAllocationByIdempotencyKey).toHaveBeenCalledWith(ids.key);
  });

  it("retries a 404 recovery outcome with the same command and key", async () => {
    const createReliefAllocation = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("connection interrupted"))
      .mockResolvedValueOnce(receipt);
    const getReliefAllocationByIdempotencyKey = vi.fn(async () => {
      throw apiError("ALLOCATION_NOT_FOUND", 404);
    });
    const api = createMockApi({
      createReliefAllocation,
      getReliefAllocationByIdempotencyKey,
    });
    await prepareConfirmedAllocation(api);
    fireEvent.click(screen.getByRole("button", { name: "Confirm allocation" }));

    expect(
      await screen.findByRole("heading", { name: "No committed allocation was found" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry allocation safely" }));
    await screen.findByRole("heading", { name: "Relief allocation finalized" });

    expect(createReliefAllocation).toHaveBeenCalledTimes(2);
    expect(createReliefAllocation.mock.calls[0]?.[2]).toBe(ids.key);
    expect(createReliefAllocation.mock.calls[1]?.[2]).toBe(ids.key);
  });

  it("preserves uncertain state when recovery fails and allows recovery-only retry", async () => {
    const createReliefAllocation = vi.fn(async () => {
      throw new TypeError("connection interrupted");
    });
    const getReliefAllocationByIdempotencyKey = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("still offline"))
      .mockResolvedValueOnce(receipt);
    const api = createMockApi({
      createReliefAllocation,
      getReliefAllocationByIdempotencyKey,
    });
    await prepareConfirmedAllocation(api);
    fireEvent.click(screen.getByRole("button", { name: "Confirm allocation" }));

    expect(
      await screen.findByRole("heading", { name: "Allocation outcome is still unknown" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry recovery" }));
    expect(await screen.findByText("Existing committed allocation recovered.")).toBeInTheDocument();
    expect(createReliefAllocation).toHaveBeenCalledOnce();
    expect(getReliefAllocationByIdempotencyKey).toHaveBeenCalledTimes(2);
  });

  it("reloads the server-ranked queue after receipt navigation", async () => {
    const api = createMockApi();
    render(
      <ReliefAllocationFeature
        api={api}
        initialPath="/relief"
        createIdempotencyKey={() => ids.key}
      />,
    );
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Open allocation workspace for Kelaniya Central Shelter",
      }),
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
    fireEvent.click(await screen.findByRole("button", { name: "Back to relief requests" }));

    await waitFor(() => expect(api.listReliefRequests).toHaveBeenCalledTimes(2));
  });
});

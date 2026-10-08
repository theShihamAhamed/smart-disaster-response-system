import { fireEvent, render, screen, within } from "@testing-library/react";
import { ZoneSeverity } from "@disaster/domain";
import { describe, expect, it } from "vitest";

import { ReliefAllocationFeature } from "./ReliefAllocationFeature";
import { createMockApi, details, ids } from "./relief-test-fixtures";

function renderWorkspace(overrides = details) {
  const api = createMockApi({ getReliefRequest: async () => overrides });
  render(
    <ReliefAllocationFeature
      api={api}
      initialPath={`/relief/${ids.request}`}
      createIdempotencyKey={() => ids.key}
    />,
  );
  return api;
}

describe("relief allocation workspace", () => {
  it("renders request, read-only shelter, zone, demand, stock, and allocation history", async () => {
    renderWorkspace();

    expect(
      await screen.findByRole("heading", { name: "Kelaniya Central Shelter", level: 1 }),
    ).toBeInTheDocument();
    expect(screen.getByText("Medical supplies are urgently required.")).toBeInTheDocument();
    expect(screen.getByText("170")).toBeInTheDocument();
    expect(screen.getByText("200")).toBeInTheDocument();
    expect(screen.getByText(/85% occupied/i)).toBeInTheDocument();
    expect(screen.getByText("Kelani River Bank")).toBeInTheDocument();
    expect(screen.getByText("Kelaniya, Gampaha District")).toBeInTheDocument();
    expect(
      screen.getByText("Stock is revalidated when the allocation is confirmed."),
    ).toBeInTheDocument();

    const table = screen.getByRole("table");
    const waterRow = within(table).getByRole("row", { name: /water 100 40 60 60/i });
    expect(waterRow).toBeInTheDocument();
    expect(screen.getByText(/allocation …00000001/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/edit occupancy/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/edit capacity/i)).not.toBeInTheDocument();
  });

  it("accepts whole positive and zero quantities and updates shortage previews", async () => {
    renderWorkspace();
    const water = await screen.findByLabelText("Allocate Water now");
    const medical = screen.getByLabelText("Allocate Medical Kit now");

    fireEvent.change(water, { target: { value: "60" } });
    fireEvent.change(medical, { target: { value: "0" } });

    expect(screen.getByText("0 units short")).toBeInTheDocument();
    expect(screen.getByText("20 units short")).toBeInTheDocument();
    expect(screen.getByText("Covered by warehouse allocation")).toBeInTheDocument();
  });

  it("blocks quantities above the displayed maximum", async () => {
    renderWorkspace();
    fireEvent.change(await screen.findByLabelText("Allocate Water now"), {
      target: { value: "61" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Review allocation" }));

    expect(screen.getByText("Enter no more than 60 units.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Demand and current stock" })).toBeInTheDocument();
  });

  it("requires an eligible returned partner for every positive shortage", async () => {
    renderWorkspace();
    await screen.findByLabelText("Allocate Water now");
    fireEvent.click(screen.getByRole("button", { name: "Review allocation" }));

    expect(screen.getAllByText("Select a partner for this shortage.")).toHaveLength(2);
    const partnerSelects = screen.getAllByLabelText("Resupply partner");
    expect(
      within(partnerSelects[0]!).getByText("Gampaha Relief Network · Ngo"),
    ).toBeInTheDocument();
    expect(
      within(partnerSelects[0]!).getByText("District Logistics Unit · Armed Forces"),
    ).toBeInTheDocument();
  });

  it("supports a partner-backed all-zero resupply-only confirmation", async () => {
    renderWorkspace();
    await screen.findByLabelText("Allocate Water now");
    for (const select of screen.getAllByLabelText("Resupply partner")) {
      fireEvent.change(select, { target: { value: ids.partner } });
    }
    fireEvent.click(screen.getByRole("button", { name: "Review allocation" }));

    expect(
      await screen.findByRole("heading", { name: "Confirm relief allocation" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/warehouse allocation: 0 units/i)).toBeInTheDocument();
    expect(screen.getByText("60 units requested")).toBeInTheDocument();
    expect(screen.getByText("20 units requested")).toBeInTheDocument();
  });

  it("shows available rescue teams only for a critical request with positive allocation", async () => {
    renderWorkspace();
    const water = await screen.findByLabelText("Allocate Water now");
    expect(screen.queryByLabelText("Available rescue team")).not.toBeInTheDocument();

    fireEvent.change(water, { target: { value: "1" } });
    const rescue = screen.getByLabelText("Available rescue team");
    expect(within(rescue).getByText("Kelani Rescue One")).toBeInTheDocument();
    fireEvent.change(rescue, { target: { value: ids.team } });

    fireEvent.change(water, { target: { value: "0" } });
    expect(screen.queryByLabelText("Available rescue team")).not.toBeInTheDocument();
    fireEvent.change(water, { target: { value: "1" } });
    expect(screen.getByLabelText("Available rescue team")).toHaveValue("");
  });

  it("never shows rescue selection for a non-critical zone", async () => {
    renderWorkspace({
      ...details,
      targetZone: { ...details.targetZone, severity: ZoneSeverity.HIGH },
    });
    fireEvent.change(await screen.findByLabelText("Allocate Water now"), {
      target: { value: "10" },
    });

    expect(screen.queryByLabelText("Available rescue team")).not.toBeInTheDocument();
  });
});

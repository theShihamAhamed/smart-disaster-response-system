import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VerificationDashboard } from "./VerificationDashboard";
import type { VerificationApi } from "./verification-api";

const report = {
  id: "40000000-0000-4000-8000-000000000001",
  status: "PENDING" as const,
  hazardType: "FLOOD",
  submittedAt: "2026-09-25T10:00:00.000Z",
  requiresExtraReview: true,
};
const review = {
  ...report,
  description: "Flood water is crossing the main road.",
  photoRef: "photo.jpg",
  location: {
    latitude: 6.9271,
    longitude: 79.8612,
    districtId: "district-1",
    address: "Main road",
    source: "GPS" as const,
  },
};
function api(overrides: Partial<VerificationApi> = {}): VerificationApi {
  return {
    listPendingReports: vi.fn(async () => [report]),
    getReportForReview: vi.fn(async () => review),
    ...overrides,
  };
}

describe("VerificationDashboard", () => {
  afterEach(cleanup);
  it("shows loading then pending reports without decision actions", async () => {
    render(<VerificationDashboard api={api()} />);
    expect(screen.getByText(/loading pending/i)).toBeInTheDocument();
    expect(await screen.findByText("FLOOD")).toBeInTheDocument();
    expect(screen.queryByText(/^VERIFIED$/)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /verify|reject|escalate/i }),
    ).not.toBeInTheDocument();
  });
  it("shows an empty queue", async () => {
    render(<VerificationDashboard api={api({ listPendingReports: async () => [] })} />);
    expect(await screen.findByText(/no reports are awaiting/i)).toBeInTheDocument();
  });
  it("loads frozen review details and advisory context", async () => {
    render(<VerificationDashboard api={api()} />);
    fireEvent.click(await screen.findByRole("button", { name: /flood/i }));
    await waitFor(() => expect(screen.getByText(review.description)).toBeInTheDocument());
    expect(screen.getByText(/advisory only/i)).toBeInTheDocument();
    expect(screen.getByText("district-1")).toBeInTheDocument();
    expect(screen.getByAltText(/submitted evidence/i)).toBeInTheDocument();
  });
  it("shows queue and review errors", async () => {
    render(
      <VerificationDashboard
        api={api({
          listPendingReports: async () => {
            throw new Error();
          },
        })}
      />,
    );
    expect(await screen.findByText(/unable to load pending/i)).toBeInTheDocument();
  });
  it("retries the same evidence without changing the pending review state", async () => {
    render(<VerificationDashboard api={api()} />);
    fireEvent.click((await screen.findAllByRole("button", { name: /flood/i })).at(-1)!);
    const evidence = (await screen.findAllByAltText(/submitted evidence/i)).at(-1)!;
    fireEvent.error(evidence);
    expect(await screen.findByText(/evidence photo is unavailable/i)).toBeInTheDocument();
    expect(screen.getByText("Awaiting officer decision")).toBeInTheDocument();
    expect(screen.getByText("PENDING")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /verify|reject|escalate/i }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /retry evidence/i }));
    expect(screen.queryByText(/evidence photo is unavailable/i)).not.toBeInTheDocument();
    expect(screen.getByAltText(/submitted evidence/i)).toHaveAttribute("src", "photo.jpg");
    expect(screen.getByText(review.description)).toBeInTheDocument();
  });
});

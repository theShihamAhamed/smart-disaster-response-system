import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
const secondReport = {
  ...report,
  id: "40000000-0000-4000-8000-000000000002",
  hazardType: "LANDSLIDE",
};
const secondReview = {
  ...review,
  ...secondReport,
  description: "A landslide has blocked the road.",
};
function api(overrides: Partial<VerificationApi> = {}): VerificationApi {
  return {
    listPendingReports: vi.fn(async () => [report]),
    getReportForReview: vi.fn(async () => review),
    decideReport: vi.fn(async () => ({})),
    ...overrides,
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
async function selectReport(
  container: HTMLElement,
  name: RegExp,
  description: string = review.description,
) {
  const dashboard = within(container);
  fireEvent.click(await dashboard.findByRole("button", { name }));
  await dashboard.findByText(description);
  return dashboard;
}

describe("VerificationDashboard", () => {
  afterEach(cleanup);
  it("shows loading then pending reports without decision actions", async () => {
    render(<VerificationDashboard api={api()} />);
    expect(screen.getByText(/loading pending/i)).toBeInTheDocument();
    expect(await screen.findByText("FLOOD")).toBeInTheDocument();
    expect(screen.queryByText(/^VERIFIED$/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Verify" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reject" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /escalate|broadcast/i })).not.toBeInTheDocument();
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
  it("retries a failed review request for the same pending report", async () => {
    let reviewRequest = 0;
    const getReportForReview = vi.fn(async () => {
      reviewRequest += 1;
      if (reviewRequest === 1) throw new Error("review unavailable");
      return review;
    });
    const escalateReport = vi.fn();
    const client = { ...api({ getReportForReview }), escalateReport };
    const view = render(<VerificationDashboard api={client} />);
    const dashboard = within(view.container);

    fireEvent.click(await dashboard.findByRole("button", { name: /flood/i }));
    expect(await dashboard.findByText(/report details are unavailable/i)).toBeInTheDocument();
    expect(getReportForReview).toHaveBeenCalledTimes(1);

    fireEvent.click(dashboard.getByRole("button", { name: "Retry review" }));

    expect(await dashboard.findByText(review.description)).toBeInTheDocument();
    expect(getReportForReview).toHaveBeenCalledTimes(2);
    expect(getReportForReview).toHaveBeenNthCalledWith(1, report.id);
    expect(getReportForReview).toHaveBeenNthCalledWith(2, report.id);
    expect(dashboard.getByText("PENDING")).toBeInTheDocument();
    expect(dashboard.getByText("Awaiting officer decision")).toBeInTheDocument();
    expect(client.decideReport).not.toHaveBeenCalled();
    expect(escalateReport).not.toHaveBeenCalled();
  });
  it("retries the same evidence without changing the pending review state", async () => {
    const view = render(<VerificationDashboard api={api()} />);
    const dashboard = within(view.container);
    fireEvent.click(await dashboard.findByRole("button", { name: /flood/i }));
    const evidence = await dashboard.findByAltText(/submitted evidence/i);
    fireEvent.error(evidence);
    expect(await dashboard.findByText(/evidence photo is unavailable/i)).toBeInTheDocument();
    expect(dashboard.getByText("Awaiting officer decision")).toBeInTheDocument();
    expect(dashboard.getByText("PENDING")).toBeInTheDocument();
    expect(
      dashboard.queryByRole("button", { name: /escalate|broadcast/i }),
    ).not.toBeInTheDocument();
    fireEvent.click(dashboard.getByRole("button", { name: /retry evidence/i }));
    expect(dashboard.queryByText(/evidence photo is unavailable/i)).not.toBeInTheDocument();
    expect(dashboard.getByAltText(/submitted evidence/i)).toHaveAttribute("src", "photo.jpg");
    expect(dashboard.getByText(review.description)).toBeInTheDocument();
  });
  it("submits a verified decision without an officer identity", async () => {
    const client = api();
    const view = render(<VerificationDashboard api={client} />);
    const dashboard = within(view.container);
    fireEvent.click(await dashboard.findByRole("button", { name: /flood/i }));
    await dashboard.findByText(review.description);
    fireEvent.click(dashboard.getByRole("button", { name: "Verify" }));
    await waitFor(() =>
      expect(client.decideReport).toHaveBeenCalledWith(
        report.id,
        { result: "VERIFIED" },
        expect.any(String),
      ),
    );
  });
  it("submits a rejected decision without an officer identity", async () => {
    const client = api();
    const view = render(<VerificationDashboard api={client} />);
    const dashboard = within(view.container);
    fireEvent.click(await dashboard.findByRole("button", { name: /flood/i }));
    await dashboard.findByText(review.description);
    fireEvent.click(dashboard.getByRole("button", { name: "Reject" }));
    const textarea = dashboard.getByRole("textbox", { name: /rejection reason/i });
    fireEvent.change(textarea, { target: { value: "  valid reason  " } });
    fireEvent.click(dashboard.getByRole("button", { name: /confirm rejection/i }));
    await waitFor(() =>
      expect(client.decideReport).toHaveBeenCalledWith(
        report.id,
        { result: "REJECTED", reason: "valid reason" },
        expect.any(String),
      ),
    );
  });

  it.each([
    { label: "empty", value: "" },
    { label: "fewer than 10 trimmed characters", value: " 123456789 " },
    { label: "more than 500 trimmed characters", value: ` ${"x".repeat(501)} ` },
  ])("blocks a $label rejection reason", async ({ value }) => {
    const client = api();
    const view = render(<VerificationDashboard api={client} />);
    const dashboard = await selectReport(view.container, /flood/i);
    fireEvent.click(dashboard.getByRole("button", { name: "Reject" }));
    fireEvent.change(dashboard.getByRole("textbox", { name: /rejection reason/i }), {
      target: { value },
    });
    fireEvent.click(dashboard.getByRole("button", { name: /confirm rejection/i }));

    expect(await dashboard.findByRole("alert")).toHaveTextContent(/10 to 500 characters/i);
    expect(client.decideReport).not.toHaveBeenCalled();
    expect(dashboard.getByText("PENDING")).toBeInTheDocument();
  });

  it.each([
    { length: 10, label: "exactly 10" },
    { length: 500, label: "exactly 500" },
  ])("accepts a rejection reason with $label trimmed characters", async ({ length }) => {
    const client = api();
    const view = render(<VerificationDashboard api={client} />);
    const dashboard = await selectReport(view.container, /flood/i);
    fireEvent.click(dashboard.getByRole("button", { name: "Reject" }));
    fireEvent.change(dashboard.getByRole("textbox", { name: /rejection reason/i }), {
      target: { value: ` ${"x".repeat(length)} ` },
    });
    fireEvent.click(dashboard.getByRole("button", { name: /confirm rejection/i }));

    await waitFor(() =>
      expect(client.decideReport).toHaveBeenCalledWith(
        report.id,
        { result: "REJECTED", reason: "x".repeat(length) },
        expect.any(String),
      ),
    );
  });

  it("prevents duplicate submissions while a decision is pending", async () => {
    const pendingDecision = deferred<unknown>();
    const client = api({ decideReport: vi.fn(() => pendingDecision.promise) });
    const view = render(<VerificationDashboard api={client} />);
    const dashboard = await selectReport(view.container, /flood/i);

    fireEvent.click(dashboard.getByRole("button", { name: "Verify" }));
    await waitFor(() => expect(client.decideReport).toHaveBeenCalledTimes(1));
    expect(dashboard.getByRole("button", { name: "Verify" })).toBeDisabled();
    expect(dashboard.getByRole("button", { name: "Reject" })).toBeDisabled();
    expect(dashboard.getByText("PENDING")).toBeInTheDocument();
    expect(dashboard.queryByText(/successfully/i)).not.toBeInTheDocument();

    fireEvent.click(dashboard.getByRole("button", { name: "Verify" }));
    expect(client.decideReport).toHaveBeenCalledTimes(1);
    pendingDecision.resolve({});
    await dashboard.findByText(/verified successfully/i);
  });

  it("refreshes the queue and clears active review after successful Verify", async () => {
    const listPendingReports = vi.fn().mockResolvedValueOnce([report]).mockResolvedValueOnce([]);
    const client = api({ listPendingReports });
    const view = render(<VerificationDashboard api={client} />);
    const dashboard = await selectReport(view.container, /flood/i);
    fireEvent.click(dashboard.getByRole("button", { name: "Verify" }));

    expect(await dashboard.findByText(/verified successfully/i)).toBeInTheDocument();
    expect(await dashboard.findByText(/no reports are awaiting/i)).toBeInTheDocument();
    expect(dashboard.queryByText(review.description)).not.toBeInTheDocument();
    expect(dashboard.getByText(/select a pending report/i)).toBeInTheDocument();
    expect(listPendingReports).toHaveBeenCalledTimes(2);
  });

  it("refreshes the queue after successful Reject", async () => {
    const listPendingReports = vi.fn().mockResolvedValueOnce([report]).mockResolvedValueOnce([]);
    const client = api({ listPendingReports });
    const view = render(<VerificationDashboard api={client} />);
    const dashboard = await selectReport(view.container, /flood/i);
    fireEvent.click(dashboard.getByRole("button", { name: "Reject" }));
    fireEvent.change(dashboard.getByRole("textbox", { name: /rejection reason/i }), {
      target: { value: "A valid rejection reason" },
    });
    fireEvent.click(dashboard.getByRole("button", { name: /confirm rejection/i }));

    expect(await dashboard.findByText(/rejected successfully/i)).toBeInTheDocument();
    expect(await dashboard.findByText(/no reports are awaiting/i)).toBeInTheDocument();
    expect(listPendingReports).toHaveBeenCalledTimes(2);
  });

  it("handles a backend 422 safely without finalizing the report", async () => {
    const client = api({
      decideReport: vi.fn(async () => {
        throw {
          status: 422,
          body: { error: { code: "VALIDATION_ERROR", message: "unsafe backend detail" } },
        };
      }),
    });
    const view = render(<VerificationDashboard api={client} />);
    const dashboard = await selectReport(view.container, /flood/i);
    fireEvent.click(dashboard.getByRole("button", { name: "Verify" }));

    expect(await dashboard.findByRole("alert")).toHaveTextContent(/unable to submit.*retry/i);
    expect(dashboard.queryByText(/unsafe backend detail/i)).not.toBeInTheDocument();
    expect(dashboard.getByText("PENDING")).toBeInTheDocument();
    expect(dashboard.getByText("Awaiting officer decision")).toBeInTheDocument();
    expect(dashboard.queryByText(/verified successfully/i)).not.toBeInTheDocument();
  });

  it("handles REPORT_ALREADY_PROCESSED by refreshing without applying a decision", async () => {
    const listPendingReports = vi.fn().mockResolvedValueOnce([report]).mockResolvedValueOnce([]);
    const client = api({
      listPendingReports,
      decideReport: vi.fn(async () => {
        throw {
          status: 409,
          body: {
            error: { code: "REPORT_ALREADY_PROCESSED", message: "Already processed" },
          },
        };
      }),
    });
    const view = render(<VerificationDashboard api={client} />);
    const dashboard = await selectReport(view.container, /flood/i);
    fireEvent.click(dashboard.getByRole("button", { name: "Verify" }));

    expect(await dashboard.findByRole("alert")).toHaveTextContent(/already been processed/i);
    expect(await dashboard.findByText(/no reports are awaiting/i)).toBeInTheDocument();
    expect(dashboard.queryByText(review.description)).not.toBeInTheDocument();
    expect(dashboard.queryByText(/verified successfully/i)).not.toBeInTheDocument();
    expect(client.decideReport).toHaveBeenCalledTimes(1);
    expect(listPendingReports).toHaveBeenCalledTimes(2);
  });

  it("keeps a network-failed attempt pending and reuses its key on exact retry", async () => {
    const client = api({
      decideReport: vi
        .fn()
        .mockRejectedValueOnce(new Error("network unavailable"))
        .mockResolvedValueOnce({}),
    });
    const view = render(<VerificationDashboard api={client} />);
    const dashboard = await selectReport(view.container, /flood/i);
    fireEvent.click(dashboard.getByRole("button", { name: "Verify" }));

    expect(await dashboard.findByRole("alert")).toHaveTextContent(/unable to submit.*retry/i);
    expect(dashboard.getByText("PENDING")).toBeInTheDocument();
    expect(dashboard.getByText("Awaiting officer decision")).toBeInTheDocument();
    expect(dashboard.queryByText(/verified successfully/i)).not.toBeInTheDocument();
    const firstKey = vi.mocked(client.decideReport).mock.calls[0]?.[2];
    expect(firstKey).toEqual(expect.any(String));

    fireEvent.click(dashboard.getByRole("button", { name: "Verify" }));
    await waitFor(() => expect(client.decideReport).toHaveBeenCalledTimes(2));
    expect(vi.mocked(client.decideReport).mock.calls[1]?.[2]).toBe(firstKey);
  });

  it("uses a new key when a failed VERIFIED attempt changes to REJECTED", async () => {
    const client = api({
      decideReport: vi
        .fn()
        .mockRejectedValueOnce(new Error("server unavailable"))
        .mockResolvedValueOnce({}),
    });
    const view = render(<VerificationDashboard api={client} />);
    const dashboard = await selectReport(view.container, /flood/i);
    fireEvent.click(dashboard.getByRole("button", { name: "Verify" }));
    await dashboard.findByRole("alert");

    fireEvent.click(dashboard.getByRole("button", { name: "Reject" }));
    fireEvent.change(dashboard.getByRole("textbox", { name: /rejection reason/i }), {
      target: { value: "A valid rejection reason" },
    });
    fireEvent.click(dashboard.getByRole("button", { name: /confirm rejection/i }));
    await waitFor(() => expect(client.decideReport).toHaveBeenCalledTimes(2));

    expect(vi.mocked(client.decideReport).mock.calls[1]?.[1]).toEqual({
      result: "REJECTED",
      reason: "A valid rejection reason",
    });
    expect(vi.mocked(client.decideReport).mock.calls[1]?.[2]).not.toBe(
      vi.mocked(client.decideReport).mock.calls[0]?.[2],
    );
  });

  it("uses a new key when the normalized reason changes after a failed rejection", async () => {
    const client = api({
      decideReport: vi
        .fn()
        .mockRejectedValueOnce(new Error("server unavailable"))
        .mockResolvedValueOnce({}),
    });
    const view = render(<VerificationDashboard api={client} />);
    const dashboard = await selectReport(view.container, /flood/i);
    fireEvent.click(dashboard.getByRole("button", { name: "Reject" }));
    const reasonInput = dashboard.getByRole("textbox", { name: /rejection reason/i });
    fireEvent.change(reasonInput, { target: { value: "First valid reason" } });
    fireEvent.click(dashboard.getByRole("button", { name: /confirm rejection/i }));
    await dashboard.findByRole("alert");

    fireEvent.change(reasonInput, { target: { value: "Second valid reason" } });
    fireEvent.click(dashboard.getByRole("button", { name: /confirm rejection/i }));
    await waitFor(() => expect(client.decideReport).toHaveBeenCalledTimes(2));

    expect(vi.mocked(client.decideReport).mock.calls[1]?.[2]).not.toBe(
      vi.mocked(client.decideReport).mock.calls[0]?.[2],
    );
  });

  it("uses a new key after selecting a different report", async () => {
    const client = api({
      listPendingReports: vi.fn(async () => [report, secondReport]),
      getReportForReview: vi.fn(async (id) => (id === report.id ? review : secondReview)),
      decideReport: vi
        .fn()
        .mockRejectedValueOnce(new Error("network unavailable"))
        .mockResolvedValueOnce({}),
    });
    const view = render(<VerificationDashboard api={client} />);
    const dashboard = await selectReport(view.container, /flood/i);
    fireEvent.click(dashboard.getByRole("button", { name: "Verify" }));
    await dashboard.findByRole("alert");
    fireEvent.click(await dashboard.findByRole("button", { name: /landslide/i }));
    await dashboard.findByText(secondReview.description);
    fireEvent.click(dashboard.getByRole("button", { name: "Verify" }));
    await waitFor(() => expect(client.decideReport).toHaveBeenCalledTimes(2));

    expect(vi.mocked(client.decideReport).mock.calls[1]?.[0]).toBe(secondReport.id);
    expect(vi.mocked(client.decideReport).mock.calls[1]?.[2]).not.toBe(
      vi.mocked(client.decideReport).mock.calls[0]?.[2],
    );
  });
});

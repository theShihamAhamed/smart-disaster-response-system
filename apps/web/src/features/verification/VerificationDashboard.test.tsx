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
const demoEvidenceReview = { ...review, photoRef: "/evidence/demo-flood.svg" };
const verifiedReview = { ...review, status: "VERIFIED" as const };
const rejectedReview = { ...review, status: "REJECTED" as const };
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
    escalateVerifiedReport: vi.fn(async () => ({
      httpStatus: 201 as const,
      draft: {
        alertId: "70000000-0000-4000-8000-000000000001",
        sourceReportId: report.id,
        status: "DRAFT" as const,
        version: 1,
      },
    })),
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
  fireEvent.load(dashboard.getByAltText(/submitted evidence/i));
  return dashboard;
}
function confirmDecision(dashboard: ReturnType<typeof within>) {
  fireEvent.click(dashboard.getByRole("button", { name: "Confirm decision" }));
}
function prepareVerifiedConfirmation(dashboard: ReturnType<typeof within>, notes?: string) {
  fireEvent.click(dashboard.getByRole("button", { name: "Verify" }));
  if (notes !== undefined) {
    fireEvent.change(dashboard.getByRole("textbox", { name: /optional verification notes/i }), {
      target: { value: notes },
    });
  }
  fireEvent.click(dashboard.getByRole("button", { name: /continue to confirmation/i }));
}

describe("VerificationDashboard", () => {
  afterEach(cleanup);
  it("shows loading then pending reports without decision actions", async () => {
    render(<VerificationDashboard api={api()} />);
    expect(screen.getByText(/loading pending/i)).toBeInTheDocument();
    expect(await screen.findByText("FLOOD")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Verify Hazard Reports" })).toBeInTheDocument();
    expect(
      screen.getByText("Review citizen hazard reports and make a verified or rejected decision."),
    ).toBeInTheDocument();
    expect(screen.getByText("1", { selector: ".queue-count" })).toBeInTheDocument();
    expect(screen.queryByText(/^VERIFIED$/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Verify" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reject" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /escalate|broadcast/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
  it("shows an empty queue", async () => {
    render(<VerificationDashboard api={api({ listPendingReports: async () => [] })} />);
    expect(await screen.findByText(/no reports are awaiting/i)).toBeInTheDocument();
  });
  it("loads frozen review details and advisory context", async () => {
    render(<VerificationDashboard api={api()} />);
    fireEvent.click(await screen.findByRole("button", { name: /flood/i }));
    await waitFor(() => expect(screen.getByText(review.description)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /flood/i })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText(/advisory only/i)).toBeInTheDocument();
    expect(screen.getByText("District ID")).toBeInTheDocument();
    expect(screen.getByText("district-1")).toBeInTheDocument();
    expect(screen.getByAltText(/submitted evidence/i)).toBeInTheDocument();
  });
  it("enables Verify and Reject only after evidence loads successfully", async () => {
    const client = api({ getReportForReview: vi.fn(async () => demoEvidenceReview) });
    const view = render(<VerificationDashboard api={client} />);
    const dashboard = within(view.container);
    const queueItem = await dashboard.findByRole("button", { name: /flood/i });
    expect(queueItem).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(queueItem);
    await dashboard.findByText(review.description);

    expect(dashboard.getByRole("button", { name: "Verify" })).toBeDisabled();
    expect(dashboard.getByRole("button", { name: "Reject" })).toBeDisabled();
    expect(dashboard.queryByRole("dialog")).not.toBeInTheDocument();

    const evidence = dashboard.getByAltText(/submitted evidence/i);
    expect(evidence).toHaveAttribute("src", "/evidence/demo-flood.svg");
    fireEvent.load(evidence);

    expect(dashboard.getByRole("button", { name: "Verify" })).toBeEnabled();
    expect(dashboard.getByRole("button", { name: "Reject" })).toBeEnabled();
  });
  it.each([
    { status: "VERIFIED", details: verifiedReview },
    { status: "REJECTED", details: rejectedReview },
  ])("shows a read-only final state for a $status review", async ({ status, details }) => {
    const client = api({ getReportForReview: vi.fn(async () => details) });
    const view = render(<VerificationDashboard api={client} />);
    const dashboard = within(view.container);
    fireEvent.click(await dashboard.findByRole("button", { name: /flood/i }));

    await waitFor(() =>
      expect(dashboard.getByRole("status")).toHaveTextContent(`Final status: ${status}.`),
    );
    expect(dashboard.queryByRole("button", { name: "Verify" })).not.toBeInTheDocument();
    expect(dashboard.queryByRole("button", { name: "Reject" })).not.toBeInTheDocument();
    expect(dashboard.queryByRole("dialog")).not.toBeInTheDocument();
    expect(client.decideReport).not.toHaveBeenCalled();
  });
  it.each([
    { status: "PENDING", details: review },
    { status: "REJECTED", details: rejectedReview },
  ])("does not offer escalation for a $status report", async ({ details }) => {
    const client = api({ getReportForReview: vi.fn(async () => details) });
    const view = render(<VerificationDashboard api={client} />);
    const dashboard = await selectReport(view.container, /flood/i);

    expect(
      dashboard.queryByRole("button", { name: "Escalate to Warning" }),
    ).not.toBeInTheDocument();
    expect(client.escalateVerifiedReport).not.toHaveBeenCalled();
  });
  it("prepares and displays a new DRAFT from a VERIFIED report", async () => {
    const escalateVerifiedReport = vi.fn<VerificationApi["escalateVerifiedReport"]>(async () => ({
      httpStatus: 201 as const,
      draft: {
        alertId: "70000000-0000-4000-8000-000000000001",
        sourceReportId: report.id,
        status: "DRAFT" as const,
        version: 1,
      },
    }));
    const broadcastAlert = vi.fn();
    const client = {
      ...api({
        getReportForReview: vi.fn(async () => verifiedReview),
        escalateVerifiedReport,
      }),
      broadcastAlert,
    };
    const view = render(<VerificationDashboard api={client} />);
    const dashboard = await selectReport(view.container, /flood/i);

    fireEvent.click(dashboard.getByRole("button", { name: "Escalate to Warning" }));

    const escalationStatus = within(
      dashboard.getByRole("region", { name: "Draft alert escalation" }),
    );
    expect(
      await escalationStatus.findByText(/a new draft alert was prepared/i),
    ).toBeInTheDocument();
    expect(escalationStatus.getByText("70000000-0000-4000-8000-000000000001")).toBeInTheDocument();
    expect(escalationStatus.getByText(report.id)).toBeInTheDocument();
    expect(escalationStatus.getByText("DRAFT")).toBeInTheDocument();
    expect(escalationStatus.getByText("1")).toBeInTheDocument();
    expect(dashboard.getByText("VERIFIED")).toBeInTheDocument();
    expect(dashboard.queryByRole("button", { name: "Verify" })).not.toBeInTheDocument();
    expect(dashboard.queryByRole("button", { name: "Reject" })).not.toBeInTheDocument();
    expect(escalateVerifiedReport).toHaveBeenCalledWith(report.id, expect.any(String));
    expect(escalateVerifiedReport.mock.calls[0]?.[1].trim()).not.toBe("");
    expect(broadcastAlert).not.toHaveBeenCalled();
  });
  it("handles an existing DRAFT returned with HTTP 200", async () => {
    const client = api({
      getReportForReview: vi.fn(async () => verifiedReview),
      escalateVerifiedReport: vi.fn(async () => ({
        httpStatus: 200 as const,
        draft: {
          alertId: "70000000-0000-4000-8000-000000000001",
          sourceReportId: report.id,
          status: "DRAFT" as const,
          version: 2,
        },
      })),
    });
    const view = render(<VerificationDashboard api={client} />);
    const dashboard = await selectReport(view.container, /flood/i);

    fireEvent.click(dashboard.getByRole("button", { name: "Escalate to Warning" }));

    expect(await dashboard.findByText(/an existing draft alert was returned/i)).toBeInTheDocument();
    expect(dashboard.getByText("70000000-0000-4000-8000-000000000001")).toBeInTheDocument();
    expect(dashboard.getByText("DRAFT")).toBeInTheDocument();
    expect(client.escalateVerifiedReport).toHaveBeenCalledTimes(1);
    expect(
      dashboard.queryByRole("button", { name: "Escalate to Warning" }),
    ).not.toBeInTheDocument();
  });
  it("prevents duplicate escalation while a request is pending", async () => {
    const pendingEscalation =
      deferred<Awaited<ReturnType<VerificationApi["escalateVerifiedReport"]>>>();
    const client = api({
      getReportForReview: vi.fn(async () => verifiedReview),
      escalateVerifiedReport: vi.fn(() => pendingEscalation.promise),
    });
    const view = render(<VerificationDashboard api={client} />);
    const dashboard = await selectReport(view.container, /flood/i);
    const escalateButton = dashboard.getByRole("button", { name: "Escalate to Warning" });

    fireEvent.click(escalateButton);
    fireEvent.click(escalateButton);

    expect(client.escalateVerifiedReport).toHaveBeenCalledTimes(1);
    expect(escalateButton).toBeDisabled();
    expect(
      within(dashboard.getByRole("region", { name: "Draft alert escalation" })).getByRole("status"),
    ).toHaveTextContent(/preparing draft alert/i);
    expect(dashboard.getByText("VERIFIED")).toBeInTheDocument();
    pendingEscalation.resolve({
      httpStatus: 201,
      draft: {
        alertId: "70000000-0000-4000-8000-000000000001",
        sourceReportId: report.id,
        status: "DRAFT",
        version: 1,
      },
    });
    expect(await dashboard.findByText(/a new draft alert was prepared/i)).toBeInTheDocument();
  });
  it("shows safe escalation errors and reuses the key on network retry", async () => {
    const escalateVerifiedReport = vi
      .fn()
      .mockRejectedValueOnce(new Error("network unavailable"))
      .mockResolvedValueOnce({
        httpStatus: 200 as const,
        draft: {
          alertId: "70000000-0000-4000-8000-000000000001",
          sourceReportId: report.id,
          status: "DRAFT" as const,
          version: 1,
        },
      });
    const client = api({
      getReportForReview: vi.fn(async () => verifiedReview),
      escalateVerifiedReport,
    });
    const view = render(<VerificationDashboard api={client} />);
    const dashboard = await selectReport(view.container, /flood/i);

    fireEvent.click(dashboard.getByRole("button", { name: "Escalate to Warning" }));
    expect(await dashboard.findByRole("alert")).toHaveTextContent(
      /unable to prepare the draft alert/i,
    );
    expect(dashboard.getByText("VERIFIED")).toBeInTheDocument();
    const firstKey = escalateVerifiedReport.mock.calls[0]?.[1];

    fireEvent.click(dashboard.getByRole("button", { name: "Escalate to Warning" }));

    await waitFor(() => expect(escalateVerifiedReport).toHaveBeenCalledTimes(2));
    expect(escalateVerifiedReport.mock.calls[1]?.[1]).toBe(firstKey);
  });
  it("refreshes report state after escalation is rejected as ineligible", async () => {
    const listPendingReports = vi.fn().mockResolvedValueOnce([report]).mockResolvedValueOnce([]);
    const getReportForReview = vi
      .fn()
      .mockResolvedValueOnce(verifiedReview)
      .mockResolvedValueOnce(rejectedReview);
    const client = api({
      listPendingReports,
      getReportForReview,
      escalateVerifiedReport: vi.fn(async () => {
        throw { status: 409, body: { error: { code: "REPORT_NOT_VERIFIED" } } };
      }),
    });
    const view = render(<VerificationDashboard api={client} />);
    const dashboard = await selectReport(view.container, /flood/i);

    fireEvent.click(dashboard.getByRole("button", { name: "Escalate to Warning" }));

    expect(await dashboard.findByRole("alert")).toHaveTextContent(
      /unable to prepare the draft alert/i,
    );
    await waitFor(() => expect(dashboard.getByText("REJECTED")).toBeInTheDocument());
    expect(dashboard.getByText(/final status: rejected/i)).toBeInTheDocument();
    expect(
      dashboard.queryByRole("button", { name: "Escalate to Warning" }),
    ).not.toBeInTheDocument();
    expect(dashboard.queryByRole("button", { name: "Verify" })).not.toBeInTheDocument();
    expect(dashboard.queryByRole("button", { name: "Reject" })).not.toBeInTheDocument();
    expect(getReportForReview).toHaveBeenCalledTimes(2);
    expect(listPendingReports).toHaveBeenCalledTimes(2);
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
    const getReportForReview = vi.fn(async (reportId: string) =>
      reportId === report.id ? review : secondReview,
    );
    const escalateVerifiedReport = vi.fn();
    const client = api({
      listPendingReports: vi.fn(async () => [report, secondReport]),
      getReportForReview,
      escalateVerifiedReport,
    });
    const view = render(<VerificationDashboard api={client} />);
    const dashboard = within(view.container);
    fireEvent.click(await dashboard.findByRole("button", { name: /flood/i }));
    const evidence = await dashboard.findByAltText(/submitted evidence/i);
    fireEvent.error(evidence);
    expect(await dashboard.findByText(/evidence photo is unavailable/i)).toBeInTheDocument();
    expect(dashboard.queryByAltText(/submitted evidence/i)).not.toBeInTheDocument();
    expect(dashboard.getByText("Awaiting officer decision")).toBeInTheDocument();
    expect(dashboard.getByText("PENDING")).toBeInTheDocument();
    expect(dashboard.getByRole("button", { name: "Verify" })).toBeDisabled();
    expect(dashboard.getByRole("button", { name: "Reject" })).toBeDisabled();
    expect(
      dashboard.queryByRole("button", { name: /escalate|broadcast/i }),
    ).not.toBeInTheDocument();

    fireEvent.click(dashboard.getByRole("button", { name: /flood/i }));
    expect(dashboard.getByText(/evidence photo is unavailable/i)).toBeInTheDocument();
    expect(dashboard.queryByAltText(/submitted evidence/i)).not.toBeInTheDocument();
    expect(getReportForReview).toHaveBeenCalledTimes(1);
    expect(dashboard.getByRole("button", { name: "Verify" })).toBeDisabled();
    expect(dashboard.getByRole("button", { name: "Reject" })).toBeDisabled();

    fireEvent.click(dashboard.getByRole("button", { name: /retry evidence/i }));
    expect(dashboard.queryByText(/evidence photo is unavailable/i)).not.toBeInTheDocument();
    const retriedEvidence = dashboard.getByAltText(/submitted evidence/i);
    expect(retriedEvidence).toHaveAttribute("src", "photo.jpg");
    expect(retriedEvidence).not.toBe(evidence);
    expect(dashboard.getByRole("button", { name: "Verify" })).toBeDisabled();
    expect(dashboard.getByRole("button", { name: "Reject" })).toBeDisabled();
    expect(dashboard.getByText(review.description)).toBeInTheDocument();
    expect(client.decideReport).not.toHaveBeenCalled();
    expect(escalateVerifiedReport).not.toHaveBeenCalled();

    fireEvent.load(retriedEvidence);

    expect(dashboard.getByRole("button", { name: "Verify" })).toBeEnabled();
    expect(dashboard.getByRole("button", { name: "Reject" })).toBeEnabled();
    expect(dashboard.getByText("PENDING")).toBeInTheDocument();

    fireEvent.click(dashboard.getByRole("button", { name: /landslide/i }));
    expect(await dashboard.findByText(secondReview.description)).toBeInTheDocument();
    expect(dashboard.getByRole("button", { name: "Verify" })).toBeDisabled();
    expect(dashboard.getByRole("button", { name: "Reject" })).toBeDisabled();
    expect(dashboard.getByAltText(/submitted evidence for landslide/i)).toBeInTheDocument();
    expect(client.decideReport).not.toHaveBeenCalled();
    expect(escalateVerifiedReport).not.toHaveBeenCalled();
  });
  it("submits a verified decision without an officer identity", async () => {
    const client = api();
    const view = render(<VerificationDashboard api={client} />);
    const dashboard = await selectReport(view.container, /flood/i);
    prepareVerifiedConfirmation(dashboard);
    expect(dashboard.getByRole("dialog")).toHaveTextContent(report.id);
    expect(dashboard.getByRole("dialog")).toHaveTextContent("VERIFIED");
    expect(client.decideReport).not.toHaveBeenCalled();
    confirmDecision(dashboard);
    await waitFor(() =>
      expect(client.decideReport).toHaveBeenCalledWith(
        report.id,
        { result: "VERIFIED" },
        expect.any(String),
      ),
    );
  });
  it("trims optional VERIFIED notes, shows them in confirmation, and submits them", async () => {
    const client = api({
      decideReport: vi.fn(async () => ({ reason: "Evidence was checked against the location." })),
    });
    const view = render(<VerificationDashboard api={client} />);
    const dashboard = await selectReport(view.container, /flood/i);

    fireEvent.click(dashboard.getByRole("button", { name: "Verify" }));
    const notes = dashboard.getByRole("textbox", { name: /optional verification notes/i });
    expect(notes).toBeInTheDocument();
    fireEvent.change(notes, {
      target: { value: "  Evidence was checked against the location.  " },
    });
    fireEvent.click(dashboard.getByRole("button", { name: /continue to confirmation/i }));

    expect(dashboard.getByRole("dialog")).toHaveTextContent(
      "Verification notes: Evidence was checked against the location.",
    );
    expect(client.decideReport).not.toHaveBeenCalled();
    confirmDecision(dashboard);
    await waitFor(() =>
      expect(client.decideReport).toHaveBeenCalledWith(
        report.id,
        { result: "VERIFIED", reason: "Evidence was checked against the location." },
        expect.any(String),
      ),
    );
    expect(
      dashboard.getByText("Verification notes: Evidence was checked against the location."),
    ).toBeInTheDocument();
  });
  it("omits whitespace-only VERIFIED notes from the request", async () => {
    const client = api();
    const view = render(<VerificationDashboard api={client} />);
    const dashboard = await selectReport(view.container, /flood/i);

    prepareVerifiedConfirmation(dashboard, "  \t  ");
    expect(dashboard.getByRole("dialog")).not.toHaveTextContent(/verification notes/i);
    confirmDecision(dashboard);

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
    const dashboard = await selectReport(view.container, /flood/i);
    fireEvent.click(dashboard.getByRole("button", { name: "Reject" }));
    const textarea = dashboard.getByRole("textbox", { name: /rejection reason/i });
    fireEvent.change(textarea, { target: { value: "  valid reason  " } });
    fireEvent.click(dashboard.getByRole("button", { name: /continue to confirmation/i }));
    expect(dashboard.getByRole("dialog")).toHaveTextContent(report.id);
    expect(dashboard.getByRole("dialog")).toHaveTextContent("REJECTED");
    expect(dashboard.getByRole("dialog")).toHaveTextContent("valid reason");
    expect(client.decideReport).not.toHaveBeenCalled();
    confirmDecision(dashboard);
    await waitFor(() =>
      expect(client.decideReport).toHaveBeenCalledWith(
        report.id,
        { result: "REJECTED", reason: "valid reason" },
        expect.any(String),
      ),
    );
  });

  it("cancels either decision confirmation without submitting; rejected reason remains", async () => {
    const client = api();
    const view = render(<VerificationDashboard api={client} />);
    const dashboard = await selectReport(view.container, /flood/i);

    prepareVerifiedConfirmation(dashboard);
    fireEvent.click(dashboard.getByRole("button", { name: "Cancel" }));
    expect(dashboard.queryByRole("dialog")).not.toBeInTheDocument();
    expect(client.decideReport).not.toHaveBeenCalled();

    fireEvent.click(dashboard.getByRole("button", { name: "Reject" }));
    const reasonInput = dashboard.getByRole("textbox", { name: /rejection reason/i });
    fireEvent.change(reasonInput, { target: { value: "  A valid rejection reason  " } });
    fireEvent.click(dashboard.getByRole("button", { name: /continue to confirmation/i }));
    fireEvent.click(dashboard.getByRole("button", { name: "Cancel" }));

    expect(dashboard.queryByRole("dialog")).not.toBeInTheDocument();
    expect(reasonInput).toHaveValue("  A valid rejection reason  ");
    expect(client.decideReport).not.toHaveBeenCalled();
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
    fireEvent.click(dashboard.getByRole("button", { name: /continue to confirmation/i }));

    expect(await dashboard.findByRole("alert")).toHaveTextContent(/10 to 500 characters/i);
    expect(dashboard.queryByRole("dialog")).not.toBeInTheDocument();
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
    fireEvent.click(dashboard.getByRole("button", { name: /continue to confirmation/i }));
    confirmDecision(dashboard);

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

    prepareVerifiedConfirmation(dashboard);
    expect(client.decideReport).not.toHaveBeenCalled();
    confirmDecision(dashboard);
    await waitFor(() => expect(client.decideReport).toHaveBeenCalledTimes(1));
    expect(dashboard.getByRole("button", { name: "Verify" })).toBeDisabled();
    expect(dashboard.getByRole("button", { name: "Reject" })).toBeDisabled();
    expect(dashboard.getByText("PENDING")).toBeInTheDocument();
    expect(dashboard.queryByText(/successfully/i)).not.toBeInTheDocument();

    confirmDecision(dashboard);
    expect(client.decideReport).toHaveBeenCalledTimes(1);
    pendingDecision.resolve({});
    await dashboard.findByText(/verified successfully/i);
  });

  it("refreshes the queue and retains a read-only VERIFIED review after successful Verify", async () => {
    const listPendingReports = vi.fn().mockResolvedValueOnce([report]).mockResolvedValueOnce([]);
    const client = api({ listPendingReports });
    const view = render(<VerificationDashboard api={client} />);
    const dashboard = await selectReport(view.container, /flood/i);
    prepareVerifiedConfirmation(dashboard);
    confirmDecision(dashboard);

    expect(await dashboard.findByText(/verified successfully/i)).toBeInTheDocument();
    expect(await dashboard.findByText(/no reports are awaiting/i)).toBeInTheDocument();
    expect(dashboard.getByText(review.description)).toBeInTheDocument();
    expect(dashboard.getByText("VERIFIED")).toBeInTheDocument();
    expect(dashboard.getByRole("button", { name: "Escalate to Warning" })).toBeInTheDocument();
    expect(dashboard.queryByRole("button", { name: "Verify" })).not.toBeInTheDocument();
    expect(dashboard.queryByRole("button", { name: "Reject" })).not.toBeInTheDocument();
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
    fireEvent.click(dashboard.getByRole("button", { name: /continue to confirmation/i }));
    confirmDecision(dashboard);

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
    prepareVerifiedConfirmation(dashboard);
    confirmDecision(dashboard);

    expect(await dashboard.findByRole("alert")).toHaveTextContent(/unable to submit.*retry/i);
    expect(dashboard.queryByText(/unsafe backend detail/i)).not.toBeInTheDocument();
    expect(dashboard.getByText("PENDING")).toBeInTheDocument();
    expect(dashboard.getByText("Awaiting officer decision")).toBeInTheDocument();
    expect(dashboard.queryByText(/verified successfully/i)).not.toBeInTheDocument();
  });

  it.each([
    { status: "VERIFIED", details: verifiedReview },
    { status: "REJECTED", details: rejectedReview },
  ])(
    "keeps a clear read-only view after REPORT_ALREADY_PROCESSED ($status)",
    async ({ status, details }) => {
      const listPendingReports = vi.fn().mockResolvedValueOnce([report]).mockResolvedValueOnce([]);
      const getReportForReview = vi
        .fn()
        .mockResolvedValueOnce(review)
        .mockResolvedValueOnce(details);
      const client = api({
        listPendingReports,
        getReportForReview,
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
      prepareVerifiedConfirmation(dashboard);
      confirmDecision(dashboard);

      expect(await dashboard.findByRole("alert")).toHaveTextContent(/already been processed/i);
      await waitFor(() =>
        expect(dashboard.getByRole("status")).toHaveTextContent(`Final status: ${status}.`),
      );
      expect(await dashboard.findByText(/no reports are awaiting/i)).toBeInTheDocument();
      expect(dashboard.getByText(review.description)).toBeInTheDocument();
      expect(dashboard.queryByRole("button", { name: "Verify" })).not.toBeInTheDocument();
      expect(dashboard.queryByRole("button", { name: "Reject" })).not.toBeInTheDocument();
      expect(dashboard.queryByRole("dialog")).not.toBeInTheDocument();
      expect(client.decideReport).toHaveBeenCalledTimes(1);
      expect(getReportForReview).toHaveBeenCalledTimes(2);
      expect(getReportForReview).toHaveBeenNthCalledWith(2, report.id);
      expect(listPendingReports).toHaveBeenCalledTimes(2);
    },
  );

  it("keeps a network-failed attempt pending and reuses its key on exact retry", async () => {
    const client = api({
      decideReport: vi
        .fn()
        .mockRejectedValueOnce(new Error("network unavailable"))
        .mockResolvedValueOnce({}),
    });
    const view = render(<VerificationDashboard api={client} />);
    const dashboard = await selectReport(view.container, /flood/i);
    prepareVerifiedConfirmation(dashboard);
    confirmDecision(dashboard);

    expect(await dashboard.findByRole("alert")).toHaveTextContent(/unable to submit.*retry/i);
    expect(dashboard.getByText("PENDING")).toBeInTheDocument();
    expect(dashboard.getByText("Awaiting officer decision")).toBeInTheDocument();
    expect(dashboard.queryByText(/verified successfully/i)).not.toBeInTheDocument();
    const firstKey = vi.mocked(client.decideReport).mock.calls[0]?.[2];
    expect(firstKey).toEqual(expect.any(String));

    confirmDecision(dashboard);
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
    prepareVerifiedConfirmation(dashboard);
    confirmDecision(dashboard);
    await dashboard.findByRole("alert");

    fireEvent.click(dashboard.getByRole("button", { name: "Reject" }));
    fireEvent.change(dashboard.getByRole("textbox", { name: /rejection reason/i }), {
      target: { value: "A valid rejection reason" },
    });
    fireEvent.click(dashboard.getByRole("button", { name: /continue to confirmation/i }));
    confirmDecision(dashboard);
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
    fireEvent.click(dashboard.getByRole("button", { name: /continue to confirmation/i }));
    confirmDecision(dashboard);
    await dashboard.findByRole("alert");

    fireEvent.change(reasonInput, { target: { value: "Second valid reason" } });
    fireEvent.click(dashboard.getByRole("button", { name: /continue to confirmation/i }));
    confirmDecision(dashboard);
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
    prepareVerifiedConfirmation(dashboard);
    confirmDecision(dashboard);
    await dashboard.findByRole("alert");
    fireEvent.click(await dashboard.findByRole("button", { name: /landslide/i }));
    await dashboard.findByText(secondReview.description);
    expect(dashboard.getByRole("button", { name: "Verify" })).toBeDisabled();
    expect(dashboard.getByRole("button", { name: "Reject" })).toBeDisabled();
    fireEvent.load(dashboard.getByAltText(/submitted evidence/i));
    expect(dashboard.getByRole("button", { name: "Verify" })).toBeEnabled();
    expect(dashboard.getByRole("button", { name: "Reject" })).toBeEnabled();
    prepareVerifiedConfirmation(dashboard);
    confirmDecision(dashboard);
    await waitFor(() => expect(client.decideReport).toHaveBeenCalledTimes(2));

    expect(vi.mocked(client.decideReport).mock.calls[1]?.[0]).toBe(secondReport.id);
    expect(vi.mocked(client.decideReport).mock.calls[1]?.[2]).not.toBe(
      vi.mocked(client.decideReport).mock.calls[0]?.[2],
    );
  });
});

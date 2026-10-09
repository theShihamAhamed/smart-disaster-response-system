import { describe, expect, it } from "vitest";
import { completeDraft, createStack } from "../testing/builders";

describe("ReportStatusService (read-only)", () => {
  it("shows what an officer decided, including the rejection reason", async () => {
    const stack = createStack();
    const draft = completeDraft();
    await stack.submission.submit(draft);
    const reportId = stack.server.reports.get(draft.clientReportId)?.reportId ?? "";

    stack.server.statuses.set(reportId, { reportId, status: "REJECTED", reason: "Not a flood." });
    const rejected = await stack.status.refresh(draft.clientReportId);
    expect(rejected?.acknowledgement).toMatchObject({
      status: "REJECTED",
      rejectionReason: "Not a flood.",
    });

    stack.server.statuses.set(reportId, { reportId, status: "VERIFIED" });
    const verified = await stack.status.refresh(draft.clientReportId);
    expect(verified?.acknowledgement).toMatchObject({ status: "VERIFIED", rejectionReason: null });
  });

  it("does not ask the server about a report that is still only on the phone", async () => {
    const stack = createStack();
    stack.connectivity.setOnline(false);
    const draft = completeDraft();
    await stack.submission.submit(draft);
    const result = await stack.status.refresh(draft.clientReportId);
    expect(result?.state).toBe("PENDING_SYNC");
  });

  it("keeps the old status when the server cannot be reached", async () => {
    const stack = createStack();
    const draft = completeDraft();
    await stack.submission.submit(draft);
    stack.server.statusFails = true;
    const result = await stack.status.refresh(draft.clientReportId);
    expect(result?.acknowledgement?.status).toBe("PENDING");
  });

  it("returns null for a report that does not exist", async () => {
    expect(await createStack().status.refresh("missing")).toBeNull();
  });

  it("refreshes every confirmed report at once", async () => {
    const stack = createStack();
    const draft = completeDraft();
    await stack.submission.submit(draft);
    const reportId = stack.server.reports.get(draft.clientReportId)?.reportId ?? "";
    stack.server.statuses.set(reportId, { reportId, status: "VERIFIED" });
    const all = await stack.status.refreshAll();
    expect(all[0]?.acknowledgement?.status).toBe("VERIFIED");
  });
});

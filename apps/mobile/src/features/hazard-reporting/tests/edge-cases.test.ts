import { afterEach, describe, expect, it, vi } from "vitest";
import { createHttpHazardReportApi } from "../adapters/http-hazard-report-api";
import { PhotoRepository } from "../repositories/photo-repository";
import { ReportSubmissionService } from "../services/report-submission-service";
import { buildSubmitPayload } from "../validation/report-validation";
import { completeDraft, createStack } from "../testing/builders";
import * as feature from "../index";
import { FakeConnectivity } from "../testing/fakes";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("edge cases", () => {
  it("sends a saved report that has no local photo copy without touching photo storage", async () => {
    const stack = createStack();
    const draft = completeDraft();
    await stack.repository.savePending({
      payload: buildSubmitPayload(draft, "photo://already-gone.jpg"),
      localPhotoUri: null,
      createdAt: "2026-10-05T09:00:00.000Z",
    });
    const outcome = await stack.sync.sendOne(draft.clientReportId);
    expect(outcome.kind).toBe("SYNCED");
    expect(stack.photoStorage.files.size).toBe(0);
  });

  it("uses the real clock for the creation time when none is provided", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-05T08:00:00.000Z"));
    const stack = createStack();
    const submission = new ReportSubmissionService({
      repository: stack.repository,
      photos: new PhotoRepository(stack.photoStorage),
      sync: stack.sync,
      connectivity: stack.connectivity,
    });
    const draft = completeDraft();
    await submission.submit(draft);
    expect((await stack.repository.get(draft.clientReportId))?.createdAt).toBe(
      "2026-10-05T08:00:00.000Z",
    );
  });

  it("uses the phone's own fetch when no custom one is given", async () => {
    const fakeFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ reportId: "r1", status: "PENDING" }), { status: 200 }),
      );
    vi.stubGlobal("fetch", fakeFetch);
    const api = createHttpHazardReportApi({
      baseUrl: "http://localhost:4000/api/v1",
      devUserId: null,
      timeoutMs: 1_000,
    });
    await expect(api.getStatus("r1")).resolves.toEqual({ reportId: "r1", status: "PENDING" });
    expect(fakeFetch).toHaveBeenCalledTimes(1);
  });

  it("tells listeners when the connection changes, and stops after they unsubscribe", async () => {
    const connectivity = new FakeConnectivity(false);
    const seen: boolean[] = [];
    const stop = connectivity.subscribe((online) => seen.push(online));
    connectivity.setOnline(true);
    connectivity.setOnline(false);
    stop();
    connectivity.setOnline(true);
    expect(seen).toEqual([true, false]);
    expect(await connectivity.isOnline()).toBe(true);
  });

  it("treats an unexpected error from the server connection as retryable and keeps the report", async () => {
    const stack = createStack();
    const draft = completeDraft();
    stack.server.submit = () => Promise.reject(new Error("something odd"));
    const result = await stack.submission.submit(draft);
    expect(result).toMatchObject({ kind: "QUEUED", reason: "SERVER_UNREACHABLE" });
    expect((await stack.repository.get(draft.clientReportId))?.state).toBe("PENDING_SYNC");
  });

  it("shows Pending Verification when the server has no newer status to report", async () => {
    const stack = createStack();
    const draft = completeDraft();
    await stack.submission.submit(draft);
    const refreshed = await stack.status.refresh(draft.clientReportId);
    expect(refreshed?.acknowledgement?.status).toBe("PENDING");
  });

  it("exposes the whole feature through one index file", () => {
    expect(typeof feature.createDraft).toBe("function");
    expect(typeof feature.validateDraft).toBe("function");
    expect(typeof feature.captureGpsLocation).toBe("function");
    expect(typeof feature.createHttpHazardReportApi).toBe("function");
    expect(typeof feature.ReportSubmissionService).toBe("function");
    expect(typeof feature.ReportSyncService).toBe("function");
    expect(typeof feature.OfflineReportRepository).toBe("function");
  });
});

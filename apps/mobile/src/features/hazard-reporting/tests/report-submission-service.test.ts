import { describe, expect, it } from "vitest";
import { HazardReportHttpError } from "../ports/hazard-report-api";
import { describeResult } from "../presentation/labels";
import { setDescription } from "../form/report-draft";
import { SUBMISSION_MESSAGES } from "../services/report-submission-service";
import {
  completeDraft,
  completeManualDraft,
  createStack,
  GOOD_DESCRIPTION,
  restartApp,
} from "../testing/builders";
import { createDraft } from "../form/report-draft";
import { sequentialIds } from "../testing/fakes";

describe("ReportSubmissionService - online", () => {
  it("submits, stores the acknowledgement and shows Pending Verification", async () => {
    const stack = createStack();
    const draft = completeDraft();
    const result = await stack.submission.submit(draft);

    expect(result.kind).toBe("SUBMITTED");
    expect(describeResult(result).title).toBe("Pending Verification");
    expect(stack.server.reports.size).toBe(1);
    const record = await stack.repository.get(draft.clientReportId);
    expect(record).toMatchObject({ state: "SYNCED" });
    expect(record?.acknowledgement?.status).toBe("PENDING");
  });

  it("sends the canonical payload: trimmed text, the draft's own id, a photo reference, no status", async () => {
    const stack = createStack();
    const draft = setDescription(completeDraft(), `   ${GOOD_DESCRIPTION}   `);
    await stack.submission.submit(draft);
    const sent = stack.server.submitCalls[0];
    expect(sent?.key).toBe(draft.clientReportId);
    expect(sent?.payload).toEqual({
      clientReportId: draft.clientReportId,
      hazardType: "FLOOD",
      description: GOOD_DESCRIPTION,
      photoRef: `photo://${draft.clientReportId}.jpg`,
      location: { latitude: 6.9271, longitude: 79.8612, source: "GPS" },
    });
  });

  it("sends a confirmed manual pin with the source MANUAL", async () => {
    const stack = createStack();
    await stack.submission.submit(completeManualDraft());
    expect(stack.server.submitCalls[0]?.payload.location).toEqual({
      latitude: 6.95,
      longitude: 79.9,
      source: "MANUAL",
    });
  });

  it("accepts an outside-area volunteer report without any accusing message", async () => {
    const stack = createStack();
    stack.server.outsideArea = true;
    const result = await stack.submission.submit(completeDraft());
    expect(result.kind).toBe("SUBMITTED");
    expect(result.kind === "SUBMITTED" && result.acknowledgement).toMatchObject({
      outsideAssignedArea: true,
      requiresExtraReview: true,
    });
    const text = JSON.stringify(describeResult(result)).toLowerCase();
    expect(text).not.toMatch(/outside|wrong|blame|not allowed|your fault/);
  });

  it("never lets the phone decide VERIFIED or REJECTED: the status comes from the server", async () => {
    const stack = createStack();
    const result = await stack.submission.submit(completeDraft());
    expect(result.kind === "SUBMITTED" && result.acknowledgement.status).toBe("PENDING");
    expect(JSON.stringify(stack.server.submitCalls[0]?.payload)).not.toMatch(
      /VERIFIED|REJECTED|status/,
    );
  });
});

describe("ReportSubmissionService - offline and failures", () => {
  it("saves the report locally as Pending Sync when offline, with the same id and photo", async () => {
    const stack = createStack();
    stack.connectivity.setOnline(false);
    const draft = completeDraft();
    const result = await stack.submission.submit(draft);

    expect(result).toEqual({
      kind: "QUEUED",
      clientReportId: draft.clientReportId,
      reason: "OFFLINE",
    });
    expect(describeResult(result).title).toBe("Pending Sync");
    expect(stack.server.submitCalls).toHaveLength(0);
    const record = await stack.repository.get(draft.clientReportId);
    expect(record).toMatchObject({
      state: "PENDING_SYNC",
      clientReportId: draft.clientReportId,
      localPhotoUri: `file:///documents/${draft.clientReportId}.jpg`,
    });
    expect(stack.photoStorage.files.size).toBe(1);
  });

  it("keeps the report when the network fails during sending", async () => {
    const stack = createStack();
    stack.server.unreachable = true;
    const draft = completeDraft();
    const result = await stack.submission.submit(draft);
    expect(result).toEqual({
      kind: "QUEUED",
      clientReportId: draft.clientReportId,
      reason: "SERVER_UNREACHABLE",
    });
    expect((await stack.repository.get(draft.clientReportId))?.state).toBe("PENDING_SYNC");
  });

  it("goes from Pending Sync to Pending Verification when the connection returns", async () => {
    const stack = createStack();
    stack.connectivity.setOnline(false);
    const draft = completeDraft();
    await stack.submission.submit(draft);

    stack.connectivity.setOnline(true);
    await stack.sync.syncQueue();
    const record = await stack.repository.get(draft.clientReportId);
    expect(record?.state).toBe("SYNCED");
    expect(record?.acknowledgement?.status).toBe("PENDING");
    expect(stack.server.reports.size).toBe(1);
  });

  it("a retry after a lost server answer reuses the same clientReportId and makes ONE server report", async () => {
    const stack = createStack();
    stack.server.loseNextResponse = true;
    const draft = completeDraft();
    const first = await stack.submission.submit(draft);
    expect(first.kind).toBe("QUEUED");
    expect(stack.server.reports.size).toBe(1);

    const second = await stack.submission.submit(draft);
    expect(second.kind).toBe("SUBMITTED");
    expect(stack.server.reports.size).toBe(1);
    expect(new Set(stack.server.submitCalls.map((c) => c.key))).toEqual(
      new Set([draft.clientReportId]),
    );
  });

  it("repeated taps on Submit share one submission", async () => {
    const stack = createStack();
    const draft = completeDraft();
    const results = await Promise.all([
      stack.submission.submit(draft),
      stack.submission.submit(draft),
      stack.submission.submit(draft),
    ]);
    expect(results.every((r) => r.kind === "SUBMITTED")).toBe(true);
    expect(stack.server.submitCalls).toHaveLength(1);
    expect(stack.server.reports.size).toBe(1);
  });

  it("submitting an already-confirmed report again does not contact the server again", async () => {
    const stack = createStack();
    const draft = completeDraft();
    await stack.submission.submit(draft);
    const again = await stack.submission.submit(draft);
    expect(again.kind).toBe("SUBMITTED");
    expect(stack.server.submitCalls).toHaveLength(1);
  });

  it("queues several offline reports, survives an app restart, then sends them all once", async () => {
    const stack = createStack();
    stack.connectivity.setOnline(false);
    const ids = sequentialIds();
    await stack.submission.submit(completeDraft(ids));
    await stack.submission.submit(completeDraft(ids));
    await stack.submission.submit(completeDraft(ids));

    const reopened = restartApp(stack);
    expect(await reopened.repository.list()).toHaveLength(3);
    reopened.connectivity.setOnline(true);
    expect((await reopened.sync.syncQueue()).synced).toHaveLength(3);
    expect(reopened.server.reports.size).toBe(3);
  });
});

describe("ReportSubmissionService - blocked submissions", () => {
  it("does not save or send an invalid draft", async () => {
    const stack = createStack();
    const result = await stack.submission.submit(createDraft(sequentialIds()));
    expect(result.kind).toBe("INVALID");
    expect(result.kind === "INVALID" && Object.keys(result.errors).sort()).toEqual([
      "description",
      "hazardType",
      "location",
      "photo",
    ]);
    expect(stack.store.records).toHaveLength(0);
    expect(stack.photoStorage.files.size).toBe(0);
    expect(stack.server.submitCalls).toHaveLength(0);
  });

  it("blocks submission when the photo cannot be saved and saves nothing incomplete", async () => {
    const stack = createStack();
    stack.photoStorage.failPersist = true;
    const result = await stack.submission.submit(completeDraft());
    expect(result).toEqual({
      kind: "NOT_SAVED",
      reason: "PHOTO",
      message: SUBMISSION_MESSAGES.photo,
    });
    expect(stack.store.records).toHaveLength(0);
    expect(stack.server.submitCalls).toHaveLength(0);
  });

  it("blocks submission when the phone's storage is full", async () => {
    const stack = createStack();
    stack.store.failWrites = true;
    const result = await stack.submission.submit(completeDraft());
    expect(result).toEqual({
      kind: "NOT_SAVED",
      reason: "STORAGE",
      message: SUBMISSION_MESSAGES.storage,
    });
    expect(stack.server.submitCalls).toHaveLength(0);
  });

  it("returns the server's complaint, then lets a corrected report go through with the SAME id", async () => {
    const stack = createStack();
    const draft = completeDraft();
    stack.server.rejectWith = new HazardReportHttpError(
      422,
      "VALIDATION_ERROR",
      "Please check it",
      {
        description: ["Too short"],
      },
    );
    const first = await stack.submission.submit(draft);
    expect(first).toMatchObject({
      kind: "SERVER_REJECTED",
      message: "Please check it",
      fieldErrors: { description: ["Too short"] },
    });
    expect(describeResult(first).title).toBe("Report not accepted");

    stack.server.rejectWith = null;
    const second = await stack.submission.submit(draft);
    expect(second.kind).toBe("SUBMITTED");
    expect(stack.server.reports.size).toBe(1);
    expect((await stack.repository.list()).map((r) => r.clientReportId)).toEqual([
      draft.clientReportId,
    ]);
  });
});

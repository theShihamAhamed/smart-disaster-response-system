import { describe, expect, it } from "vitest";
import { coordinatesToPoint, DEFAULT_MAP_REGION, pointToCoordinates } from "../location/mock-map";
import {
  describeGpsFailure,
  describeResult,
  HAZARD_TYPE_LABELS,
  reportBadge,
  serverStatusLabel,
} from "../presentation/labels";
import type { SubmissionResult } from "../services/report-submission-service";
import { buildSubmitPayload } from "../validation/report-validation";
import { completeDraft } from "../testing/builders";
import type { Acknowledgement, StoredReport } from "../types";

function stored(overrides: Partial<StoredReport> = {}): StoredReport {
  const draft = completeDraft();
  return {
    clientReportId: draft.clientReportId,
    state: "PENDING_SYNC",
    payload: buildSubmitPayload(draft, "photo://1.jpg"),
    localPhotoUri: null,
    createdAt: "2026-10-05T09:00:00.000Z",
    attempts: 0,
    lastError: null,
    needsAttention: false,
    acknowledgement: null,
    ...overrides,
  };
}

const ack = (overrides: Partial<Acknowledgement> = {}): Acknowledgement => ({
  reportId: "r",
  status: "PENDING",
  outsideAssignedArea: false,
  requiresExtraReview: false,
  submittedAt: "2026-10-05T10:00:00.000Z",
  rejectionReason: null,
  ...overrides,
});

describe("status labels", () => {
  it("shows Pending Sync for a report that is only on the phone", () => {
    expect(reportBadge(stored())).toMatchObject({ label: "Pending Sync", tone: "waiting" });
  });

  it("explains a report the server refused", () => {
    const badge = reportBadge(stored({ needsAttention: true, lastError: "Bad data" }));
    expect(badge).toMatchObject({ label: "Pending Sync", hint: "Bad data" });
    expect(reportBadge(stored({ needsAttention: true })).hint).toContain("could not accept");
  });

  it("shows Pending Verification once the server has the report", () => {
    const badge = reportBadge(stored({ state: "SYNCED", acknowledgement: ack() }));
    expect(badge).toMatchObject({ label: "Pending Verification", tone: "review", hint: null });
  });

  it("shows Verified and Rejected (with the reason) as the server says", () => {
    expect(
      reportBadge(stored({ state: "SYNCED", acknowledgement: ack({ status: "VERIFIED" }) })),
    ).toMatchObject({
      label: "Verified",
      tone: "good",
    });
    expect(
      reportBadge(
        stored({
          state: "SYNCED",
          acknowledgement: ack({ status: "REJECTED", rejectionReason: "Not a flood." }),
        }),
      ),
    ).toMatchObject({ label: "Rejected", tone: "bad", hint: "Not a flood." });
  });

  it("names the three server statuses", () => {
    expect(serverStatusLabel("PENDING")).toBe("Pending Verification");
    expect(serverStatusLabel("VERIFIED")).toBe("Verified");
    expect(serverStatusLabel("REJECTED")).toBe("Rejected");
  });

  it("has a label for every hazard type", () => {
    expect(HAZARD_TYPE_LABELS).toEqual({
      FLOOD: "Flood",
      LANDSLIDE: "Landslide",
      CYCLONE: "Cyclone",
      DROUGHT: "Drought",
    });
  });
});

describe("result messages", () => {
  const cases: [string, SubmissionResult, string][] = [
    [
      "received by the server",
      { kind: "SUBMITTED", acknowledgement: ack() },
      "Pending Verification",
    ],
    [
      "saved while offline",
      { kind: "QUEUED", clientReportId: "x", reason: "OFFLINE" },
      "Pending Sync",
    ],
    [
      "saved, server unreachable",
      { kind: "QUEUED", clientReportId: "x", reason: "SERVER_UNREACHABLE" },
      "Pending Sync",
    ],
    [
      "refused by the server",
      { kind: "SERVER_REJECTED", message: "Nope", fieldErrors: {} },
      "Report not accepted",
    ],
    [
      "could not be saved",
      { kind: "NOT_SAVED", reason: "PHOTO", message: "No photo" },
      "Report not saved",
    ],
    ["form has problems", { kind: "INVALID", errors: {} }, "Please check the form"],
  ];

  it.each(cases)("%s", (_name, result, title) => {
    const message = describeResult(result);
    expect(message.title).toBe(title);
    expect(message.body.length).toBeGreaterThan(0);
  });

  it("shows the server's or the phone's own message unchanged when something is refused", () => {
    expect(describeResult({ kind: "SERVER_REJECTED", message: "Nope", fieldErrors: {} }).body).toBe(
      "Nope",
    );
    expect(describeResult({ kind: "NOT_SAVED", reason: "PHOTO", message: "No photo" }).body).toBe(
      "No photo",
    );
  });

  it("tells an offline user the report is saved, and an unreachable-server user it will retry", () => {
    expect(
      describeResult({ kind: "QUEUED", clientReportId: "x", reason: "OFFLINE" }).body,
    ).toContain("offline");
    expect(
      describeResult({ kind: "QUEUED", clientReportId: "x", reason: "SERVER_UNREACHABLE" }).body,
    ).toContain("could not reach");
  });

  it("explains every GPS failure with 'Location Not Found' and the manual-pin way out", () => {
    for (const reason of [
      "PERMISSION_DENIED",
      "UNAVAILABLE",
      "INVALID_POSITION",
      "TIMEOUT",
    ] as const) {
      const message = describeGpsFailure(reason);
      expect(message.title).toBe("Location Not Found");
      expect(message.body).toContain("place a pin");
    }
  });
});

describe("mock map", () => {
  const size = { width: 300, height: 200 };
  const { minLatitude, maxLatitude, minLongitude, maxLongitude } = DEFAULT_MAP_REGION;

  it("maps the corners: top-left is north-west, bottom-right is south-east", () => {
    expect(pointToCoordinates({ x: 0, y: 0 }, size)).toEqual({
      latitude: maxLatitude,
      longitude: minLongitude,
    });
    expect(pointToCoordinates({ x: 300, y: 200 }, size)).toEqual({
      latitude: minLatitude,
      longitude: maxLongitude,
    });
  });

  it("maps the centre to the middle of the region", () => {
    expect(pointToCoordinates({ x: 150, y: 100 }, size)).toEqual({ latitude: 6.9, longitude: 80 });
  });

  it("keeps taps outside the map on the map edge", () => {
    expect(pointToCoordinates({ x: -50, y: 999 }, size)).toEqual({
      latitude: minLatitude,
      longitude: minLongitude,
    });
  });

  it("draws the pin where the tap was (round trip) and clamps places outside the region", () => {
    const tap = { x: 120, y: 60 };
    const point = coordinatesToPoint(pointToCoordinates(tap, size), size);
    expect(point.x).toBeCloseTo(tap.x, 3);
    expect(point.y).toBeCloseTo(tap.y, 3);
    expect(coordinatesToPoint({ latitude: 50, longitude: -10 }, size)).toEqual({ x: 0, y: 0 });
  });
});

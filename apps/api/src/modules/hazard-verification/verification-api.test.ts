import {
  HazardType,
  LocationSource,
  ReportStatus,
  UserRole,
  VerificationResult,
} from "@disaster/domain";
import type { DevelopmentAuthUser, ResolveDevelopmentAuthUser } from "../../development-auth.js";
import { createApp } from "../../app.js";
import type {
  DecisionCommand,
  DecisionPersistenceResult,
  HazardVerificationRepository,
  PendingReport,
  ReportForReview,
  VerificationDecisionRecord,
} from "./types.js";
import { HazardVerificationService } from "./hazard-verification.service.js";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const officerId = "10000000-0000-4000-8000-000000000003";
const citizenId = "10000000-0000-4000-8000-000000000001";
const reportId = "40000000-0000-4000-8000-000000000001";
const unknownId = "10000000-0000-4000-8000-000000000099";
const commandKey = "60000000-0000-4000-8000-000000000001";

const pendingReport: PendingReport = {
  id: reportId,
  status: ReportStatus.PENDING,
  hazardType: HazardType.FLOOD,
  submittedAt: new Date("2026-09-25T10:00:00.000Z"),
  requiresExtraReview: false,
};

const reviewReport: ReportForReview = {
  ...pendingReport,
  description: "Flood water is crossing the main road.",
  photoRef: "seed://photos/pending-flood.jpg",
  location: {
    latitude: 6.9271,
    longitude: 79.8612,
    districtId: "00000000-0000-4000-8000-000000000001",
    address: "Colombo hazard point",
    source: LocationSource.GPS,
  },
};

const users: Readonly<Record<string, DevelopmentAuthUser>> = {
  [officerId]: {
    id: officerId,
    role: UserRole.DMC_DUTY_OFFICER,
    volunteer: null,
    dmcOfficer: { canBroadcast: false },
    districtOfficer: null,
  },
  [citizenId]: {
    id: citizenId,
    role: UserRole.CITIZEN,
    volunteer: null,
    dmcOfficer: null,
    districtOfficer: null,
  },
};

class VerificationApiRepository implements HazardVerificationRepository {
  public commands: DecisionCommand[] = [];
  public constructor(private status: ReportStatus | undefined = ReportStatus.PENDING) {}

  public async listPendingReports(): Promise<readonly PendingReport[]> {
    return this.status === ReportStatus.PENDING ? [pendingReport] : [];
  }

  public async findReportForReview(id: string): Promise<ReportForReview | null> {
    return id === reportId && this.status ? { ...reviewReport, status: this.status } : null;
  }

  public async decidePendingReport(command: DecisionCommand): Promise<DecisionPersistenceResult> {
    if (!this.status) return { kind: "REPORT_NOT_FOUND" };
    if (this.status !== ReportStatus.PENDING) {
      return { kind: "REPORT_ALREADY_PROCESSED", status: this.status };
    }
    this.status = command.result;
    this.commands.push(command);
    const decision: VerificationDecisionRecord = {
      id: "42000000-0000-4000-8000-000000000001",
      ...command,
      reason: command.reason ?? null,
    };
    return { kind: "DECIDED", decision };
  }
}

function createVerificationApp(repository = new VerificationApiRepository()) {
  const resolveDevelopmentAuthUser: ResolveDevelopmentAuthUser = async (id) => users[id] ?? null;
  return {
    repository,
    app: createApp({
      resolveDevelopmentAuthUser,
      verificationService: new HazardVerificationService(
        repository,
        () => new Date("2026-10-05T10:00:00.000Z"),
      ),
    }),
  };
}

function officerRequest(app: ReturnType<typeof createVerificationApp>["app"]) {
  return {
    get: (path: string) => request(app).get(path).set("X-Dev-User-Id", officerId),
    post: (path: string) => request(app).post(path).set("X-Dev-User-Id", officerId),
  };
}

beforeEach(() => {
  process.env.DEV_AUTH_ENABLED = "true";
});

afterEach(() => {
  delete process.env.DEV_AUTH_ENABLED;
});

describe("verification API", () => {
  it("lists an authorized officer's pending queue and preserves request metadata", async () => {
    const { app } = createVerificationApp();
    const response = await officerRequest(app)
      .get("/api/v1/verification/reports")
      .set("X-Request-Id", "verification-queue");

    expect(response.status).toBe(200);
    expect(response.headers["x-request-id"]).toBe("verification-queue");
    expect(response.body).toHaveLength(1);
    expect(response.body[0]).toMatchObject({ id: reportId, status: ReportStatus.PENDING });
  });

  it("returns an empty pending queue successfully", async () => {
    const { app } = createVerificationApp(new VerificationApiRepository(ReportStatus.VERIFIED));
    await expect(officerRequest(app).get("/api/v1/verification/reports")).resolves.toMatchObject({
      status: 200,
      body: [],
    });
  });

  it("returns the frozen report-review fields", async () => {
    const { app } = createVerificationApp();
    const response = await officerRequest(app).get(`/api/v1/verification/reports/${reportId}`);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      id: reportId,
      photoRef: reviewReport.photoRef,
      location: reviewReport.location,
    });
  });

  it("maps a missing report to the standard not-found envelope", async () => {
    const { app } = createVerificationApp();
    const response = await officerRequest(app).get(`/api/v1/verification/reports/${unknownId}`);

    expect(response.status).toBe(404);
    expect(response.body.error).toMatchObject({ code: "NOT_FOUND", fieldErrors: {}, details: {} });
  });

  it("uses the trusted officer identity when verifying a pending report", async () => {
    const { app, repository } = createVerificationApp();
    const response = await officerRequest(app)
      .post(`/api/v1/verification/reports/${reportId}/decision`)
      .set("Idempotency-Key", commandKey)
      .send({ result: VerificationResult.VERIFIED });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      officerId,
      result: VerificationResult.VERIFIED,
      reason: null,
    });
    expect(repository.commands[0]?.officerId).toBe(officerId);
  });

  it("rejects with a valid reason and validates malformed decision input", async () => {
    const { app } = createVerificationApp();
    const rejected = await officerRequest(app)
      .post(`/api/v1/verification/reports/${reportId}/decision`)
      .set("Idempotency-Key", commandKey)
      .send({
        result: VerificationResult.REJECTED,
        reason: "Photo does not show the reported flood location.",
      });
    expect(rejected.status).toBe(200);
    expect(rejected.body.reason).toBe("Photo does not show the reported flood location.");

    const { app: invalidApp } = createVerificationApp();
    const invalid = await officerRequest(invalidApp)
      .post(`/api/v1/verification/reports/${reportId}/decision`)
      .set("Idempotency-Key", commandKey)
      .send({ result: VerificationResult.REJECTED });
    expect(invalid.status).toBe(422);
    expect(invalid.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("maps an already-final report to the frozen conflict envelope", async () => {
    const { app } = createVerificationApp(new VerificationApiRepository(ReportStatus.VERIFIED));
    const response = await officerRequest(app)
      .post(`/api/v1/verification/reports/${reportId}/decision`)
      .set("Idempotency-Key", commandKey)
      .send({
        result: VerificationResult.REJECTED,
        reason: "Photo does not show the reported flood location.",
      });

    expect(response.status).toBe(409);
    expect(response.body.error).toMatchObject({
      code: "REPORT_ALREADY_PROCESSED",
      details: { status: ReportStatus.VERIFIED },
    });
  });

  it("rejects missing, invalid, and wrong-role development identities", async () => {
    const { app } = createVerificationApp();
    expect((await request(app).get("/api/v1/verification/reports")).status).toBe(401);
    expect(
      (await request(app).get("/api/v1/verification/reports").set("X-Dev-User-Id", unknownId))
        .status,
    ).toBe(401);
    const forbidden = await request(app)
      .get("/api/v1/verification/reports")
      .set("X-Dev-User-Id", citizenId);
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.error.code).toBe("FORBIDDEN");
  });
});

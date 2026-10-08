import {
  AlertStatus,
  HazardType,
  LocationSource,
  ReportStatus,
  UserRole,
  VerificationResult,
} from "@disaster/domain";
import { HazardBroadcastService } from "../hazard-broadcast/alert.service.js";
import type {
  ActivateAlertCommand,
  AlertPreviewData,
  AlertRecord,
  BroadcastAlertResult,
  CreateAlertPersistenceResult,
  CreateInitialAlertCommand,
  CreateReplacementDraftCommand,
  FindSimilarActiveAlertsQuery,
  HazardBroadcastRepository,
  NotificationDeliveryRecord,
  SourceReport,
  UpdateDraftAlertCommand,
} from "../hazard-broadcast/types.js";
import type { DevelopmentAuthUser, ResolveDevelopmentAuthUser } from "../../development-auth.js";
import { createApp } from "../../app.js";
import type {
  DecisionCommand,
  DecisionPersistenceResult,
  HazardVerificationRepository,
  PendingReport,
  ReportForReview,
  ReporterNotificationPort,
  VerificationDecisionRecord,
} from "./types.js";
import { HazardVerificationService } from "./hazard-verification.service.js";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const officerId = "10000000-0000-4000-8000-000000000003";
const citizenId = "10000000-0000-4000-8000-000000000001";
const reportId = "40000000-0000-4000-8000-000000000001";
const unknownId = "10000000-0000-4000-8000-000000000099";
const commandKey = "60000000-0000-4000-8000-000000000001";
const alertId = "50000000-0000-4000-8000-000000000001";

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
  public constructor(
    private status: ReportStatus | undefined = ReportStatus.PENDING,
    private readonly existingDecisionStatus?: ReportStatus.VERIFIED | ReportStatus.REJECTED,
  ) {}

  private currentStatus(): ReportStatus | undefined {
    return this.existingDecisionStatus ?? this.status;
  }

  public statusForReport(id: string): ReportStatus | null {
    return id === reportId ? (this.currentStatus() ?? null) : null;
  }

  public async listPendingReports(): Promise<readonly PendingReport[]> {
    return this.currentStatus() === ReportStatus.PENDING ? [pendingReport] : [];
  }

  public async findReportForReview(id: string): Promise<ReportForReview | null> {
    const status = this.currentStatus();
    return id === reportId && status ? { ...reviewReport, status } : null;
  }

  public async decidePendingReport(command: DecisionCommand): Promise<DecisionPersistenceResult> {
    if (command.reportId !== reportId) return { kind: "REPORT_NOT_FOUND" };
    if (!this.status) return { kind: "REPORT_NOT_FOUND" };
    if (this.existingDecisionStatus) {
      return { kind: "REPORT_ALREADY_PROCESSED", status: this.existingDecisionStatus };
    }
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

class VerificationBroadcastRepository implements HazardBroadcastRepository {
  public readonly initialAlerts = new Map<string, AlertRecord>();
  public createdInitialAlertCount = 0;
  public activationCalls = 0;
  public failOnCreate = false;

  public constructor(private readonly reports: VerificationApiRepository) {}

  public async findSourceReport(id: string): Promise<SourceReport | null> {
    const status = this.reports.statusForReport(id);
    return status ? { id, status, hazardType: HazardType.FLOOD } : null;
  }

  public async findAlertById(id: string): Promise<AlertRecord | null> {
    return [...this.initialAlerts.values()].find((alert) => alert.id === id) ?? null;
  }

  public async findInitialAlertForReport(id: string): Promise<AlertRecord | null> {
    return this.initialAlerts.get(id) ?? null;
  }

  public async findAlertPreview(id: string): Promise<AlertPreviewData | null> {
    const alert = await this.findAlertById(id);
    return alert ? { alert, targetZones: [] } : null;
  }

  public async findSimilarActiveAlerts(
    query: FindSimilarActiveAlertsQuery,
  ): Promise<AlertRecord[]> {
    void query;
    return [];
  }

  public async createInitialAlert(
    command: CreateInitialAlertCommand,
  ): Promise<CreateAlertPersistenceResult> {
    const existing = this.initialAlerts.get(command.sourceReportId);
    if (existing) return { kind: "EXISTING", alert: existing };
    if (this.failOnCreate) throw new Error("private persistence details");

    const alert: AlertRecord = {
      id: alertId,
      sourceReportId: command.sourceReportId,
      createdByOfficerId: command.createdByOfficerId,
      hazardType: command.hazardType,
      severity: command.severity,
      message: command.message,
      safetyInstructions: command.safetyInstructions,
      status: command.status,
      version: command.version,
      parentAlertId: command.parentAlertId,
      targetZoneIds: [],
      issuedAt: null,
      cancelledAt: null,
      cancellationReason: null,
    };
    this.initialAlerts.set(command.sourceReportId, alert);
    this.createdInitialAlertCount += 1;
    return { kind: "CREATED", alert };
  }

  public async updateDraftAlert(command: UpdateDraftAlertCommand): Promise<AlertRecord> {
    const existing = await this.findAlertById(command.alertId);
    if (!existing) throw new Error("Test alert does not exist.");
    const updated = {
      ...existing,
      severity: command.severity,
      message: command.message,
      safetyInstructions: command.safetyInstructions,
      targetZoneIds: command.targetZoneIds,
    };
    this.initialAlerts.set(updated.sourceReportId, updated);
    return updated;
  }

  public async activateAlert(command: ActivateAlertCommand): Promise<BroadcastAlertResult> {
    this.activationCalls += 1;
    const alert = await this.findAlertById(command.alertId);
    if (!alert) throw new Error("Test alert does not exist.");
    const deliveries: NotificationDeliveryRecord[] = [];
    return { alert, deliveries };
  }

  public async createReplacementDraft(
    command: CreateReplacementDraftCommand,
  ): Promise<AlertRecord> {
    const parent = await this.findAlertById(command.parentAlertId);
    if (!parent) throw new Error("Test parent alert does not exist.");
    const replacement: AlertRecord = {
      ...parent,
      id: `${alertId}-replacement`,
      createdByOfficerId: command.createdByOfficerId,
      version: command.version,
      parentAlertId: command.parentAlertId,
      status: AlertStatus.DRAFT,
    };
    return replacement;
  }
}

function createVerificationApp(
  repository = new VerificationApiRepository(),
  reporterNotificationPort?: ReporterNotificationPort,
) {
  const resolveDevelopmentAuthUser: ResolveDevelopmentAuthUser = async (id) => users[id] ?? null;
  const broadcastRepository = new VerificationBroadcastRepository(repository);
  return {
    repository,
    broadcastRepository,
    app: createApp({
      resolveDevelopmentAuthUser,
      verificationService: new HazardVerificationService(
        repository,
        () => new Date("2026-10-05T10:00:00.000Z"),
        reporterNotificationPort,
      ),
      broadcastService: new HazardBroadcastService(broadcastRepository),
    }),
  };
}

function officerRequest(app: ReturnType<typeof createVerificationApp>["app"]) {
  return {
    get: (path: string) => request(app).get(path).set("X-Dev-User-Id", officerId),
    post: (path: string) => request(app).post(path).set("X-Dev-User-Id", officerId),
  };
}

function escalationRequest(app: ReturnType<typeof createVerificationApp>["app"]) {
  return officerRequest(app)
    .post(`/api/v1/verification/reports/${reportId}/escalations`)
    .set("Idempotency-Key", commandKey);
}

beforeEach(() => {
  process.env.DEV_AUTH_ENABLED = "true";
});

afterEach(() => {
  delete process.env.DEV_AUTH_ENABLED;
  vi.restoreAllMocks();
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

  it("keeps a valid but unknown review UUID as not found", async () => {
    const { app } = createVerificationApp();
    const response = await officerRequest(app).get(`/api/v1/verification/reports/${unknownId}`);

    expect(response.status).toBe(404);
    expect(response.body.error).toMatchObject({ code: "NOT_FOUND", fieldErrors: {}, details: {} });
  });

  it("validates malformed UUIDs before report review lookup", async () => {
    const { app } = createVerificationApp();
    const response = await officerRequest(app).get("/api/v1/verification/reports/not-a-uuid");

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("validates malformed UUIDs before decision submission", async () => {
    const { app } = createVerificationApp();
    const response = await officerRequest(app)
      .post("/api/v1/verification/reports/not-a-uuid/decision")
      .set("Idempotency-Key", commandKey)
      .send({ result: VerificationResult.VERIFIED });

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("keeps a valid but unknown decision UUID as not found", async () => {
    const { app } = createVerificationApp();
    const response = await officerRequest(app)
      .post(`/api/v1/verification/reports/${unknownId}/decision`)
      .set("Idempotency-Key", commandKey)
      .send({ result: VerificationResult.VERIFIED });

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("NOT_FOUND");
  });

  it("rejects a malformed decision Idempotency-Key", async () => {
    const { app } = createVerificationApp();
    const response = await officerRequest(app)
      .post(`/api/v1/verification/reports/${reportId}/decision`)
      .set("Idempotency-Key", "not-a-uuid")
      .send({ result: VerificationResult.VERIFIED });

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects unknown fields in a decision request body", async () => {
    const { app } = createVerificationApp();
    const response = await officerRequest(app)
      .post(`/api/v1/verification/reports/${reportId}/decision`)
      .set("Idempotency-Key", commandKey)
      .send({ result: VerificationResult.VERIFIED, unexpected: true });

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects invalid status and unexpected fields in the pending queue query", async () => {
    const { app } = createVerificationApp();
    const invalidStatus = await officerRequest(app).get(
      "/api/v1/verification/reports?status=VERIFIED",
    );
    const unexpectedField = await officerRequest(app).get(
      "/api/v1/verification/reports?unexpected=value",
    );

    expect(invalidStatus.status).toBe(422);
    expect(invalidStatus.body.error.code).toBe("VALIDATION_ERROR");
    expect(unexpectedField.status).toBe(422);
    expect(unexpectedField.body.error.code).toBe("VALIDATION_ERROR");
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

  it("accepts optional VERIFIED notes and returns the persisted trimmed value", async () => {
    const { app, repository } = createVerificationApp();
    const response = await officerRequest(app)
      .post(`/api/v1/verification/reports/${reportId}/decision`)
      .set("Idempotency-Key", commandKey)
      .send({
        result: VerificationResult.VERIFIED,
        reason: "  Evidence checked against the location.  ",
      });

    expect(response.status).toBe(200);
    expect(response.body.reason).toBe("Evidence checked against the location.");
    expect(repository.commands[0]?.reason).toBe("Evidence checked against the location.");
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

  it("returns the committed REJECTED decision when reporter notification fails", async () => {
    const repository = new VerificationApiRepository();
    const requestDecisionNotification = vi.fn(async () => {
      throw new Error("Notification adapter unavailable.");
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { app } = createVerificationApp(repository, { requestDecisionNotification });

    const response = await officerRequest(app)
      .post(`/api/v1/verification/reports/${reportId}/decision`)
      .set("Idempotency-Key", commandKey)
      .send({
        result: VerificationResult.REJECTED,
        reason: "  Reported location does not show a hazard.  ",
      });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      reportId,
      result: VerificationResult.REJECTED,
      reason: "Reported location does not show a hazard.",
    });
    expect(repository.commands).toHaveLength(1);
    expect(await repository.listPendingReports()).toEqual([]);
    expect(requestDecisionNotification).toHaveBeenCalledOnce();
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
    expect(JSON.stringify(response.body)).not.toMatch(/P2002|23505|prisma|database/i);
  });

  it("maps a stale pending report with an existing decision to the frozen conflict envelope", async () => {
    const repository = new VerificationApiRepository(ReportStatus.PENDING, ReportStatus.REJECTED);
    const { app } = createVerificationApp(repository);
    const response = await officerRequest(app)
      .post(`/api/v1/verification/reports/${reportId}/decision`)
      .set("Idempotency-Key", commandKey)
      .send({ result: VerificationResult.VERIFIED });

    expect(response.status).toBe(409);
    expect(response.body.error).toEqual({
      code: "REPORT_ALREADY_PROCESSED",
      message: "The report has already been processed.",
      fieldErrors: {},
      details: { status: ReportStatus.REJECTED },
    });
    expect(repository.commands).toHaveLength(0);
    expect(JSON.stringify(response.body)).not.toMatch(/P2002|23505|prisma|database/i);
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

  it("escalates a VERIFIED report to a linked DRAFT without broadcast permission", async () => {
    const { app, repository, broadcastRepository } = createVerificationApp(
      new VerificationApiRepository(ReportStatus.VERIFIED),
    );
    const response = await escalationRequest(app);

    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      alertId,
      sourceReportId: reportId,
      status: AlertStatus.DRAFT,
      version: 1,
    });
    expect(broadcastRepository.initialAlerts.get(reportId)).toMatchObject({
      id: alertId,
      sourceReportId: reportId,
      status: AlertStatus.DRAFT,
      parentAlertId: null,
    });
    expect(broadcastRepository.initialAlerts.get(reportId)?.createdByOfficerId).toBe(officerId);
    expect(broadcastRepository.activationCalls).toBe(0);
    expect(repository.statusForReport(reportId)).toBe(ReportStatus.VERIFIED);
  });

  it("rejects client-supplied officerId and uses the authenticated identity", async () => {
    const { app, broadcastRepository } = createVerificationApp(
      new VerificationApiRepository(ReportStatus.VERIFIED),
    );
    const bodyIdentity = await escalationRequest(app).send({ officerId: citizenId });
    expect(bodyIdentity.status).toBe(422);
    expect(bodyIdentity.body.error.code).toBe("VALIDATION_ERROR");

    const queryIdentity = await escalationRequest(app).query({ officerId: citizenId });
    expect(queryIdentity.status).toBe(422);
    expect(queryIdentity.body.error.code).toBe("VALIDATION_ERROR");

    const headerIdentity = await escalationRequest(app).set("officerId", citizenId);
    expect(headerIdentity.status).toBe(201);
    expect(broadcastRepository.initialAlerts.get(reportId)?.createdByOfficerId).toBe(officerId);
  });

  it("rejects a missing escalation Idempotency-Key", async () => {
    const { app } = createVerificationApp(new VerificationApiRepository(ReportStatus.VERIFIED));
    const response = await officerRequest(app).post(
      `/api/v1/verification/reports/${reportId}/escalations`,
    );

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects a blank escalation Idempotency-Key", async () => {
    const { app } = createVerificationApp(new VerificationApiRepository(ReportStatus.VERIFIED));
    const response = await officerRequest(app)
      .post(`/api/v1/verification/reports/${reportId}/escalations`)
      .set("Idempotency-Key", "   ");

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects an invalid report UUID as a validation error", async () => {
    const { app } = createVerificationApp(new VerificationApiRepository(ReportStatus.VERIFIED));
    const response = await officerRequest(app)
      .post("/api/v1/verification/reports/not-a-uuid/escalations")
      .set("Idempotency-Key", commandKey);

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects an escalation request from a user with the wrong role", async () => {
    const { app } = createVerificationApp(new VerificationApiRepository(ReportStatus.VERIFIED));
    const response = await request(app)
      .post(`/api/v1/verification/reports/${reportId}/escalations`)
      .set("X-Dev-User-Id", citizenId)
      .set("Idempotency-Key", commandKey);

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("FORBIDDEN");
  });

  it("rejects an unauthenticated escalation request", async () => {
    const { app } = createVerificationApp(new VerificationApiRepository(ReportStatus.VERIFIED));
    const response = await request(app)
      .post(`/api/v1/verification/reports/${reportId}/escalations`)
      .set("Idempotency-Key", commandKey);

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("UNAUTHENTICATED");
  });

  it.each([ReportStatus.PENDING, ReportStatus.REJECTED])(
    "does not escalate a %s report",
    async (status) => {
      const { app, broadcastRepository, repository } = createVerificationApp(
        new VerificationApiRepository(status),
      );
      const response = await escalationRequest(app);

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe("REPORT_NOT_VERIFIED");
      expect(broadcastRepository.initialAlerts.size).toBe(0);
      expect(repository.statusForReport(reportId)).toBe(status);
    },
  );

  it("handles an unknown report safely during escalation", async () => {
    const { app, broadcastRepository } = createVerificationApp(
      new VerificationApiRepository(ReportStatus.VERIFIED),
    );
    const response = await officerRequest(app)
      .post(`/api/v1/verification/reports/${unknownId}/escalations`)
      .set("Idempotency-Key", commandKey);

    expect(response.status).toBe(404);
    expect(response.body.error).toMatchObject({ code: "NOT_FOUND", details: {} });
    expect(broadcastRepository.initialAlerts.size).toBe(0);
  });

  it("returns the existing initial draft on repeated escalation without duplicates", async () => {
    const { app, broadcastRepository } = createVerificationApp(
      new VerificationApiRepository(ReportStatus.VERIFIED),
    );
    const first = await escalationRequest(app);
    const repeated = await officerRequest(app)
      .post(`/api/v1/verification/reports/${reportId}/escalations`)
      .set("Idempotency-Key", "a-distinct-non-empty-retry-key");

    expect(first.status).toBe(201);
    expect(repeated.status).toBe(200);
    expect(repeated.body.alertId).toBe(first.body.alertId);
    expect(broadcastRepository.initialAlerts.size).toBe(1);
    expect(broadcastRepository.createdInitialAlertCount).toBe(1);
  });

  it("returns the standard safe error envelope for persistence failures", async () => {
    const { app, broadcastRepository } = createVerificationApp(
      new VerificationApiRepository(ReportStatus.VERIFIED),
    );
    broadcastRepository.failOnCreate = true;
    const response = await escalationRequest(app);

    expect(response.status).toBe(500);
    expect(response.body.error).toMatchObject({
      code: "INTERNAL_ERROR",
      message: "An unexpected error occurred.",
      details: {},
    });
    expect(JSON.stringify(response.body)).not.toContain("private persistence details");
  });
});

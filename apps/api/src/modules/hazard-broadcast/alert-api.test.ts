import { AlertSeverity, AlertStatus, HazardType, ReportStatus, UserRole } from "@disaster/domain";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../app.js";
import type { DevelopmentAuthUser, ResolveDevelopmentAuthUser } from "../../development-auth.js";
import { HazardBroadcastService } from "./alert.service.js";
import type {
  AlertRecord,
  CreateAlertPersistenceResult,
  CreateInitialAlertCommand,
  HazardBroadcastRepository,
  SourceReport,
} from "./types.js";

const officerId = "10000000-0000-4000-8000-000000000004";
const dutyOfficerWithoutBroadcast = "10000000-0000-4000-8000-000000000003";
const citizenId = "10000000-0000-4000-8000-000000000001";
const unknownId = "10000000-0000-4000-8000-000000000099";
const reportId = "40000000-0000-4000-8000-000000000001";
const alertId = "50000000-0000-4000-8000-000000000001";

const users: Readonly<Record<string, DevelopmentAuthUser>> = {
  [officerId]: {
    id: officerId,
    role: UserRole.DMC_DUTY_OFFICER,
    volunteer: null,
    dmcOfficer: { canBroadcast: true },
    districtOfficer: null,
  },
  [dutyOfficerWithoutBroadcast]: {
    id: dutyOfficerWithoutBroadcast,
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

class FakeBroadcastApiRepository implements HazardBroadcastRepository {
  public initialAlert: AlertRecord | null = null;
  public reportStatus: ReportStatus = ReportStatus.VERIFIED;
  public reportExists = true;

  public async findSourceReport(id: string): Promise<SourceReport | null> {
    if (!this.reportExists || id !== reportId) return null;
    return {
      id: reportId,
      status: this.reportStatus,
      hazardType: HazardType.FLOOD,
    };
  }

  public async findInitialAlertForReport(id: string): Promise<AlertRecord | null> {
    if (this.initialAlert && this.initialAlert.sourceReportId === id) {
      return this.initialAlert;
    }
    return null;
  }

  public async createInitialAlert(
    command: CreateInitialAlertCommand,
  ): Promise<CreateAlertPersistenceResult> {
    if (this.initialAlert && this.initialAlert.sourceReportId === command.sourceReportId) {
      return { kind: "EXISTING", alert: this.initialAlert };
    }
    const created: AlertRecord = {
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
    this.initialAlert = created;
    return { kind: "CREATED", alert: created };
  }
}

function createBroadcastApp(repository = new FakeBroadcastApiRepository()) {
  const resolveDevelopmentAuthUser: ResolveDevelopmentAuthUser = async (id) => users[id] ?? null;
  return {
    repository,
    app: createApp({
      resolveDevelopmentAuthUser,
      broadcastService: new HazardBroadcastService(repository),
    }),
  };
}

beforeEach(() => {
  process.env.DEV_AUTH_ENABLED = "true";
});

afterEach(() => {
  delete process.env.DEV_AUTH_ENABLED;
});

describe("POST /api/v1/alerts/from-report/:reportId", () => {
  it("creates an initial draft alert and returns 201 Created for a verified report", async () => {
    const { app } = createBroadcastApp();
    const response = await request(app)
      .post(`/api/v1/alerts/from-report/${reportId}`)
      .set("X-Dev-User-Id", officerId);

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      id: alertId,
      sourceReportId: reportId,
      createdByOfficerId: officerId,
      hazardType: HazardType.FLOOD,
      severity: AlertSeverity.ADVISORY,
      status: AlertStatus.DRAFT,
      version: 1,
      parentAlertId: null,
      message: "",
      safetyInstructions: "",
    });
  });

  it("allows DMC Duty Officer without broadcast permission to create an internal draft", async () => {
    const { app } = createBroadcastApp();
    const response = await request(app)
      .post(`/api/v1/alerts/from-report/${reportId}`)
      .set("X-Dev-User-Id", dutyOfficerWithoutBroadcast);

    expect(response.status).toBe(201);
    expect(response.body.createdByOfficerId).toBe(dutyOfficerWithoutBroadcast);
  });

  it("returns 200 OK and existing alert for an idempotent repeated call", async () => {
    const { app } = createBroadcastApp();
    const first = await request(app)
      .post(`/api/v1/alerts/from-report/${reportId}`)
      .set("X-Dev-User-Id", officerId);
    expect(first.status).toBe(201);

    const second = await request(app)
      .post(`/api/v1/alerts/from-report/${reportId}`)
      .set("X-Dev-User-Id", officerId);
    expect(second.status).toBe(200);
    expect(second.body.id).toBe(first.body.id);
  });

  it("returns 409 REPORT_NOT_VERIFIED when source report is still PENDING", async () => {
    const repository = new FakeBroadcastApiRepository();
    repository.reportStatus = ReportStatus.PENDING;
    const { app } = createBroadcastApp(repository);

    const response = await request(app)
      .post(`/api/v1/alerts/from-report/${reportId}`)
      .set("X-Dev-User-Id", officerId);

    expect(response.status).toBe(409);
    expect(response.body.error).toMatchObject({
      code: "REPORT_NOT_VERIFIED",
      details: { status: ReportStatus.PENDING },
    });
  });

  it("returns 409 REPORT_NOT_VERIFIED when source report is REJECTED", async () => {
    const repository = new FakeBroadcastApiRepository();
    repository.reportStatus = ReportStatus.REJECTED;
    const { app } = createBroadcastApp(repository);

    const response = await request(app)
      .post(`/api/v1/alerts/from-report/${reportId}`)
      .set("X-Dev-User-Id", officerId);

    expect(response.status).toBe(409);
    expect(response.body.error).toMatchObject({
      code: "REPORT_NOT_VERIFIED",
      details: { status: ReportStatus.REJECTED },
    });
  });

  it("returns 404 NOT_FOUND when report does not exist", async () => {
    const repository = new FakeBroadcastApiRepository();
    repository.reportExists = false;
    const { app } = createBroadcastApp(repository);

    const response = await request(app)
      .post(`/api/v1/alerts/from-report/${reportId}`)
      .set("X-Dev-User-Id", officerId);

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("NOT_FOUND");
  });

  it("returns 401 UNAUTHENTICATED when dev auth header is missing or unknown", async () => {
    const { app } = createBroadcastApp();
    expect((await request(app).post(`/api/v1/alerts/from-report/${reportId}`)).status).toBe(401);
    expect(
      (
        await request(app)
          .post(`/api/v1/alerts/from-report/${reportId}`)
          .set("X-Dev-User-Id", unknownId)
      ).status,
    ).toBe(401);
  });

  it("returns 403 FORBIDDEN when user has non-officer role (e.g. CITIZEN)", async () => {
    const { app } = createBroadcastApp();
    const response = await request(app)
      .post(`/api/v1/alerts/from-report/${reportId}`)
      .set("X-Dev-User-Id", citizenId);

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("FORBIDDEN");
  });

  it("validates reportId parameter format and returns 404 for non-uuid params", async () => {
    const { app } = createBroadcastApp();
    const response = await request(app)
      .post(`/api/v1/alerts/from-report/not-a-valid-uuid`)
      .set("X-Dev-User-Id", officerId);

    expect(response.status).toBe(404);
  });
});

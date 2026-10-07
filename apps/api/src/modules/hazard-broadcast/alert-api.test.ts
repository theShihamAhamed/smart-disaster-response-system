import {
  AlertSeverity,
  AlertStatus,
  DeliveryStatus,
  HazardType,
  ReportStatus,
  UserRole,
  ZoneSeverity,
} from "@disaster/domain";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../app.js";
import type { DevelopmentAuthUser, ResolveDevelopmentAuthUser } from "../../development-auth.js";
import { HazardBroadcastService } from "./alert.service.js";
import type {
  ActivateAlertCommand,
  AlertPreviewData,
  AlertRecord,
  BroadcastAlertResult,
  CancelAlertCommand,
  CreateAlertPersistenceResult,
  CreateInitialAlertCommand,
  CreateReplacementDraftCommand,
  FindSimilarActiveAlertsQuery,
  HazardBroadcastRepository,
  NotificationDeliveryRecord,
  SourceReport,
  TargetZoneSummary,
  UpdateDeliveryCommand,
  UpdateDraftAlertCommand,
} from "./types.js";
import {
  AlertAlreadyActiveError,
  AlertNotActiveError,
  AlertNotFoundError,
  AlertNotInDraftError,
} from "./types.js";

const officerId = "10000000-0000-4000-8000-000000000004";
const dutyOfficerWithoutBroadcast = "10000000-0000-4000-8000-000000000003";
const citizenId = "10000000-0000-4000-8000-000000000001";
const unknownId = "10000000-0000-4000-8000-000000000099";
const reportId = "40000000-0000-4000-8000-000000000001";
const alertId = "50000000-0000-4000-8000-000000000001";
const commandKey = "20000000-0000-4000-8000-000000000001";
const zone1 = "30000000-0000-4000-8000-000000000001";
const zone2 = "30000000-0000-4000-8000-000000000002";

const targetZonesData: TargetZoneSummary[] = [
  {
    id: zone1,
    name: "Colombo Critical Flood Zone",
    districtId: "00000000-0000-4000-8000-000000000001",
    severity: ZoneSeverity.CRITICAL,
    geometryRef: "geo:colombo-critical-v1",
  },
  {
    id: zone2,
    name: "Colombo High Risk Zone",
    districtId: "00000000-0000-4000-8000-000000000001",
    severity: ZoneSeverity.HIGH,
    geometryRef: "geo:colombo-high-v1",
  },
];

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
  public alerts: Map<string, AlertRecord> = new Map();
  public alertTargetZones: Map<string, TargetZoneSummary[]> = new Map();

  public async findSourceReport(id: string): Promise<SourceReport | null> {
    if (!this.reportExists || id !== reportId) return null;
    return {
      id: reportId,
      status: this.reportStatus,
      hazardType: HazardType.FLOOD,
    };
  }

  public async findAlertById(id: string): Promise<AlertRecord | null> {
    return (
      this.alerts.get(id) ??
      (this.initialAlert && this.initialAlert.id === id ? this.initialAlert : null)
    );
  }

  public async findInitialAlertForReport(id: string): Promise<AlertRecord | null> {
    if (this.initialAlert && this.initialAlert.sourceReportId === id) {
      return this.initialAlert;
    }
    return null;
  }

  public async findAlertPreview(id: string): Promise<AlertPreviewData | null> {
    const alert = await this.findAlertById(id);
    if (!alert) return null;
    const zones = this.alertTargetZones.get(id) ?? [];
    return {
      alert,
      targetZones: zones,
    };
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
    this.alerts.set(alertId, created);
    return { kind: "CREATED", alert: created };
  }

  public async updateDraftAlert(command: UpdateDraftAlertCommand): Promise<AlertRecord> {
    const current = this.alerts.get(command.alertId) ?? this.initialAlert!;
    const updated: AlertRecord = {
      ...current,
      severity: command.severity,
      message: command.message,
      safetyInstructions: command.safetyInstructions,
      targetZoneIds: [...command.targetZoneIds],
    };
    this.alerts.set(command.alertId, updated);
    if (this.initialAlert && this.initialAlert.id === command.alertId) {
      this.initialAlert = updated;
    }
    const matchedZones = targetZonesData.filter((z) => command.targetZoneIds.includes(z.id));
    this.alertTargetZones.set(command.alertId, matchedZones);
    return updated;
  }

  public async findSimilarActiveAlerts(
    query: FindSimilarActiveAlertsQuery,
  ): Promise<AlertRecord[]> {
    if (query.targetZoneIds.length === 0) {
      return [];
    }
    const excludeIds =
      query.excludeAlertIds ?? (query.excludeAlertId ? [query.excludeAlertId] : []);
    const results: AlertRecord[] = [];
    for (const alert of this.alerts.values()) {
      if (excludeIds.includes(alert.id)) {
        continue;
      }
      if (alert.status !== AlertStatus.ACTIVE) {
        continue;
      }
      if (alert.hazardType !== query.hazardType) {
        continue;
      }
      const hasSharedZone = alert.targetZoneIds.some((zoneId) =>
        query.targetZoneIds.includes(zoneId),
      );
      if (hasSharedZone) {
        results.push(alert);
      }
    }
    return results;
  }

  public broadcastAudits: {
    readonly alertId: string;
    readonly officerId: string;
    readonly action: string;
    readonly reason: string | null;
    readonly createdAt: Date;
  }[] = [];

  public notificationDeliveries: NotificationDeliveryRecord[] = [];

  public async activateAlert(command: ActivateAlertCommand): Promise<BroadcastAlertResult> {
    const current = this.alerts.get(command.alertId);
    if (!current) {
      throw new AlertNotFoundError(command.alertId);
    }
    if (current.status === AlertStatus.ACTIVE) {
      throw new AlertAlreadyActiveError(current.status);
    }
    if (current.status !== AlertStatus.DRAFT) {
      throw new AlertNotInDraftError(current.status);
    }

    if (current.parentAlertId) {
      const parent = this.alerts.get(current.parentAlertId);
      if (!parent) {
        throw new AlertNotFoundError(current.parentAlertId);
      }
      if (parent.status !== AlertStatus.ACTIVE) {
        throw new AlertNotActiveError(
          parent.status,
          `Cannot activate replacement alert because parent alert is ${parent.status}. Parent must be ACTIVE.`,
        );
      }
      const supersededParent: AlertRecord = {
        ...parent,
        status: AlertStatus.SUPERSEDED,
      };
      this.alerts.set(current.parentAlertId, supersededParent);
      this.broadcastAudits.push({
        alertId: current.parentAlertId,
        officerId: command.officerId,
        action: "SUPERSEDED",
        reason: command.reason ?? `Superseded by alert version ${current.version} (${current.id})`,
        createdAt: command.issuedAt,
      });
    }

    const updated: AlertRecord = {
      ...current,
      status: AlertStatus.ACTIVE,
      issuedAt: command.issuedAt,
    };
    this.alerts.set(command.alertId, updated);
    if (this.initialAlert && this.initialAlert.id === command.alertId) {
      this.initialAlert = updated;
    }

    this.broadcastAudits.push({
      alertId: command.alertId,
      officerId: command.officerId,
      action: "ACTIVATED",
      reason: command.reason ?? null,
      createdAt: command.issuedAt,
    });

    const deliveries: NotificationDeliveryRecord[] = [];
    if (command.recipientRefs && command.recipientRefs.length > 0) {
      for (const recipientRef of command.recipientRefs) {
        const delivery: NotificationDeliveryRecord = {
          id: `deliv-${deliveries.length + 1}`,
          alertId: command.alertId,
          recipientRef,
          status: DeliveryStatus.PENDING,
          attemptNo: 0,
          lastFailureReason: null,
          updatedAt: command.issuedAt,
        };
        deliveries.push(delivery);
        this.notificationDeliveries.push(delivery);
      }
    }

    return {
      alert: updated,
      deliveries,
    };
  }

  public async createReplacementDraft(
    command: CreateReplacementDraftCommand,
  ): Promise<AlertRecord> {
    const newAlertId = `50000000-0000-4000-8000-${String(this.alerts.size + 1).padStart(12, "0")}`;
    const replacement: AlertRecord = {
      id: newAlertId,
      sourceReportId: command.sourceReportId,
      createdByOfficerId: command.createdByOfficerId,
      hazardType: command.hazardType,
      severity: command.severity,
      message: command.message,
      safetyInstructions: command.safetyInstructions,
      status: command.status,
      version: command.version,
      parentAlertId: command.parentAlertId,
      targetZoneIds: [...command.targetZoneIds],
      issuedAt: null,
      cancelledAt: null,
      cancellationReason: null,
    };
    this.alerts.set(newAlertId, replacement);
    const matchedZones = targetZonesData.filter((z) => command.targetZoneIds.includes(z.id));
    this.alertTargetZones.set(newAlertId, matchedZones);
    return replacement;
  }

  public async cancelAlert(command: CancelAlertCommand): Promise<AlertRecord> {
    const current = this.alerts.get(command.alertId);
    if (!current) {
      throw new AlertNotFoundError(command.alertId);
    }
    if (current.status !== AlertStatus.ACTIVE) {
      throw new AlertNotActiveError(current.status);
    }

    const updated: AlertRecord = {
      ...current,
      status: AlertStatus.CANCELLED,
      cancelledAt: command.cancelledAt,
      cancellationReason: command.reason,
    };
    this.alerts.set(command.alertId, updated);

    this.broadcastAudits.push({
      alertId: command.alertId,
      officerId: command.officerId,
      action: "CANCELLED",
      reason: command.reason,
      createdAt: command.cancelledAt,
    });

    if (command.recipientRefs && command.recipientRefs.length > 0) {
      for (const recipientRef of command.recipientRefs) {
        const delivery: NotificationDeliveryRecord = {
          id: `deliv-${this.notificationDeliveries.length + 1}`,
          alertId: command.alertId,
          recipientRef,
          status: DeliveryStatus.PENDING,
          attemptNo: 0,
          lastFailureReason: null,
          updatedAt: command.cancelledAt,
        };
        this.notificationDeliveries.push(delivery);
      }
    }

    return updated;
  }

  public async findDeliveryById(deliveryId: string): Promise<NotificationDeliveryRecord | null> {
    const delivery = this.notificationDeliveries.find((d) => d.id === deliveryId);
    return delivery ?? null;
  }

  public async findDeliveriesByAlertId(alertId: string): Promise<NotificationDeliveryRecord[]> {
    return this.notificationDeliveries.filter((d) => d.alertId === alertId);
  }

  public async updateDelivery(command: UpdateDeliveryCommand): Promise<NotificationDeliveryRecord> {
    const index = this.notificationDeliveries.findIndex((d) => d.id === command.deliveryId);
    if (index === -1) {
      throw new Error(`Delivery ${command.deliveryId} not found`);
    }
    const current = this.notificationDeliveries[index];
    const updated: NotificationDeliveryRecord = {
      ...current,
      status: command.status,
      attemptNo: command.attemptNo,
      lastFailureReason: command.lastFailureReason,
      updatedAt: command.updatedAt,
    };
    this.notificationDeliveries[index] = updated;
    return updated;
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

describe("PATCH /api/v1/alerts/:alertId", () => {
  it("successfully edits a DRAFT alert and returns 200 OK with updated content", async () => {
    const { app } = createBroadcastApp();
    await request(app)
      .post(`/api/v1/alerts/from-report/${reportId}`)
      .set("X-Dev-User-Id", officerId);

    const response = await request(app)
      .patch(`/api/v1/alerts/${alertId}`)
      .set("X-Dev-User-Id", officerId)
      .send({
        severity: AlertSeverity.WARNING,
        message: "Flood water is rising rapidly across the northern road.",
        safetyInstructions: "Move immediately to designated relief shelters.",
        targetZoneIds: [zone1, zone2],
      });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      id: alertId,
      sourceReportId: reportId,
      status: AlertStatus.DRAFT,
      version: 1,
      parentAlertId: null,
      severity: AlertSeverity.WARNING,
      message: "Flood water is rising rapidly across the northern road.",
      safetyInstructions: "Move immediately to designated relief shelters.",
      targetZoneIds: [zone1, zone2],
    });
  });

  it("allows DMC Duty Officer with canBroadcast=false to edit a DRAFT", async () => {
    const { app } = createBroadcastApp();
    await request(app)
      .post(`/api/v1/alerts/from-report/${reportId}`)
      .set("X-Dev-User-Id", officerId);

    const response = await request(app)
      .patch(`/api/v1/alerts/${alertId}`)
      .set("X-Dev-User-Id", dutyOfficerWithoutBroadcast)
      .send({
        severity: AlertSeverity.ADVISORY,
        message: "Minor flooding alert.",
        safetyInstructions: "Avoid low-lying areas.",
        targetZoneIds: [zone1],
      });

    expect(response.status).toBe(200);
  });

  it("rejects blank message with 422 VALIDATION_ERROR", async () => {
    const { app } = createBroadcastApp();
    await request(app)
      .post(`/api/v1/alerts/from-report/${reportId}`)
      .set("X-Dev-User-Id", officerId);

    const response = await request(app)
      .patch(`/api/v1/alerts/${alertId}`)
      .set("X-Dev-User-Id", officerId)
      .send({
        severity: AlertSeverity.WARNING,
        message: "   ",
        safetyInstructions: "Follow instructions.",
        targetZoneIds: [zone1],
      });

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects blank safety instructions with 422 VALIDATION_ERROR", async () => {
    const { app } = createBroadcastApp();
    await request(app)
      .post(`/api/v1/alerts/from-report/${reportId}`)
      .set("X-Dev-User-Id", officerId);

    const response = await request(app)
      .patch(`/api/v1/alerts/${alertId}`)
      .set("X-Dev-User-Id", officerId)
      .send({
        severity: AlertSeverity.WARNING,
        message: "Valid message.",
        safetyInstructions: "   ",
        targetZoneIds: [zone1],
      });

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects message over 1000 characters with 422 VALIDATION_ERROR", async () => {
    const { app } = createBroadcastApp();
    await request(app)
      .post(`/api/v1/alerts/from-report/${reportId}`)
      .set("X-Dev-User-Id", officerId);

    const response = await request(app)
      .patch(`/api/v1/alerts/${alertId}`)
      .set("X-Dev-User-Id", officerId)
      .send({
        severity: AlertSeverity.WARNING,
        message: "a".repeat(1001),
        safetyInstructions: "Follow instructions.",
        targetZoneIds: [zone1],
      });

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects safety instructions over 1000 characters with 422 VALIDATION_ERROR", async () => {
    const { app } = createBroadcastApp();
    await request(app)
      .post(`/api/v1/alerts/from-report/${reportId}`)
      .set("X-Dev-User-Id", officerId);

    const response = await request(app)
      .patch(`/api/v1/alerts/${alertId}`)
      .set("X-Dev-User-Id", officerId)
      .send({
        severity: AlertSeverity.WARNING,
        message: "Valid message.",
        safetyInstructions: "a".repeat(1001),
        targetZoneIds: [zone1],
      });

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects empty targetZoneIds array with 422 VALIDATION_ERROR", async () => {
    const { app } = createBroadcastApp();
    await request(app)
      .post(`/api/v1/alerts/from-report/${reportId}`)
      .set("X-Dev-User-Id", officerId);

    const response = await request(app)
      .patch(`/api/v1/alerts/${alertId}`)
      .set("X-Dev-User-Id", officerId)
      .send({
        severity: AlertSeverity.WARNING,
        message: "Valid message.",
        safetyInstructions: "Valid instructions.",
        targetZoneIds: [],
      });

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 404 NOT_FOUND for unknown alertId", async () => {
    const { app } = createBroadcastApp();

    const response = await request(app)
      .patch(`/api/v1/alerts/${unknownId}`)
      .set("X-Dev-User-Id", officerId)
      .send({
        severity: AlertSeverity.WARNING,
        message: "Valid message.",
        safetyInstructions: "Valid instructions.",
        targetZoneIds: [zone1],
      });

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("NOT_FOUND");
  });

  it("returns 409 ALERT_NOT_IN_DRAFT for an ACTIVE alert", async () => {
    const repository = new FakeBroadcastApiRepository();
    repository.alerts.set(alertId, {
      id: alertId,
      sourceReportId: reportId,
      createdByOfficerId: officerId,
      hazardType: HazardType.FLOOD,
      severity: AlertSeverity.WARNING,
      message: "Active flood alert",
      safetyInstructions: "Stay indoors",
      status: AlertStatus.ACTIVE,
      version: 1,
      parentAlertId: null,
      targetZoneIds: [zone1],
      issuedAt: new Date(),
      cancelledAt: null,
      cancellationReason: null,
    });
    const { app } = createBroadcastApp(repository);

    const response = await request(app)
      .patch(`/api/v1/alerts/${alertId}`)
      .set("X-Dev-User-Id", officerId)
      .send({
        severity: AlertSeverity.EVACUATION,
        message: "Updated message.",
        safetyInstructions: "Updated instructions.",
        targetZoneIds: [zone1],
      });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("ALERT_NOT_IN_DRAFT");
    expect(response.body.error.details).toEqual({ status: AlertStatus.ACTIVE });
  });

  it("returns 403 FORBIDDEN for non-officer roles (e.g. CITIZEN)", async () => {
    const { app } = createBroadcastApp();
    const response = await request(app)
      .patch(`/api/v1/alerts/${alertId}`)
      .set("X-Dev-User-Id", citizenId)
      .send({
        severity: AlertSeverity.WARNING,
        message: "Valid message.",
        safetyInstructions: "Valid instructions.",
        targetZoneIds: [zone1],
      });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("FORBIDDEN");
  });
});

describe("GET /api/v1/alerts/:alertId/preview", () => {
  it("returns alert preview with target zone details and estimated recipients", async () => {
    const { app } = createBroadcastApp();
    await request(app)
      .post(`/api/v1/alerts/from-report/${reportId}`)
      .set("X-Dev-User-Id", officerId);

    await request(app)
      .patch(`/api/v1/alerts/${alertId}`)
      .set("X-Dev-User-Id", officerId)
      .send({
        severity: AlertSeverity.WARNING,
        message: "Flood warning for low-lying areas.",
        safetyInstructions: "Evacuate immediately.",
        targetZoneIds: [zone1, zone2],
      });

    const response = await request(app)
      .get(`/api/v1/alerts/${alertId}/preview`)
      .set("X-Dev-User-Id", officerId);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      alert: {
        id: alertId,
        severity: AlertSeverity.WARNING,
        message: "Flood warning for low-lying areas.",
        safetyInstructions: "Evacuate immediately.",
        status: AlertStatus.DRAFT,
      },
      targetZones: [
        { id: zone1, name: "Colombo Critical Flood Zone" },
        { id: zone2, name: "Colombo High Risk Zone" },
      ],
      estimatedRecipients: 0,
    });
  });

  it("allows DMC Duty Officer with canBroadcast=false to preview", async () => {
    const { app } = createBroadcastApp();
    await request(app)
      .post(`/api/v1/alerts/from-report/${reportId}`)
      .set("X-Dev-User-Id", officerId);

    const response = await request(app)
      .get(`/api/v1/alerts/${alertId}/preview`)
      .set("X-Dev-User-Id", dutyOfficerWithoutBroadcast);

    expect(response.status).toBe(200);
  });

  it("returns 404 NOT_FOUND for unknown alertId", async () => {
    const { app } = createBroadcastApp();
    const response = await request(app)
      .get(`/api/v1/alerts/${unknownId}/preview`)
      .set("X-Dev-User-Id", officerId);

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("NOT_FOUND");
  });

  it("returns 404 NOT_FOUND for malformed non-uuid alertId", async () => {
    const { app } = createBroadcastApp();
    const response = await request(app)
      .get(`/api/v1/alerts/not-a-valid-uuid/preview`)
      .set("X-Dev-User-Id", officerId);

    expect(response.status).toBe(404);
  });

  it("returns 401 UNAUTHENTICATED when dev auth header is missing", async () => {
    const { app } = createBroadcastApp();
    const response = await request(app).get(`/api/v1/alerts/${alertId}/preview`);

    expect(response.status).toBe(401);
  });

  it("returns 403 FORBIDDEN when user has non-officer role (e.g. CITIZEN)", async () => {
    const { app } = createBroadcastApp();
    const response = await request(app)
      .get(`/api/v1/alerts/${alertId}/preview`)
      .set("X-Dev-User-Id", citizenId);

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("FORBIDDEN");
  });
});

describe("GET /api/v1/alerts/:alertId/similar-active", () => {
  const activeAlertId = "50000000-0000-4000-8000-000000000002";

  it("returns matching ACTIVE alerts when hazard type matches and target zone overlaps", async () => {
    const { app, repository } = createBroadcastApp();
    await request(app)
      .post(`/api/v1/alerts/from-report/${reportId}`)
      .set("X-Dev-User-Id", officerId);

    await request(app)
      .patch(`/api/v1/alerts/${alertId}`)
      .set("X-Dev-User-Id", officerId)
      .send({
        severity: AlertSeverity.WARNING,
        message: "Flood warning.",
        safetyInstructions: "Evacuate.",
        targetZoneIds: [zone1],
      });

    repository.alerts.set(activeAlertId, {
      id: activeAlertId,
      sourceReportId: "40000000-0000-4000-8000-000000000002",
      createdByOfficerId: officerId,
      hazardType: HazardType.FLOOD,
      severity: AlertSeverity.WARNING,
      message: "Ongoing active flood",
      safetyInstructions: "Stay indoors",
      status: AlertStatus.ACTIVE,
      version: 1,
      parentAlertId: null,
      targetZoneIds: [zone1, zone2],
      issuedAt: new Date("2026-10-06T10:00:00Z"),
      cancelledAt: null,
      cancellationReason: null,
    });

    const response = await request(app)
      .get(`/api/v1/alerts/${alertId}/similar-active`)
      .set("X-Dev-User-Id", officerId);

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
    expect(response.body).toHaveLength(1);
    expect(response.body[0]).toMatchObject({
      id: activeAlertId,
      hazardType: HazardType.FLOOD,
      status: AlertStatus.ACTIVE,
      targetZoneIds: [zone1, zone2],
    });
  });

  it("allows DMC Duty Officer with canBroadcast=false to perform similar active check", async () => {
    const { app } = createBroadcastApp();
    await request(app)
      .post(`/api/v1/alerts/from-report/${reportId}`)
      .set("X-Dev-User-Id", officerId);

    const response = await request(app)
      .get(`/api/v1/alerts/${alertId}/similar-active`)
      .set("X-Dev-User-Id", dutyOfficerWithoutBroadcast);

    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
  });

  it("returns empty array when draft has no target zones", async () => {
    const { app, repository } = createBroadcastApp();
    await request(app)
      .post(`/api/v1/alerts/from-report/${reportId}`)
      .set("X-Dev-User-Id", officerId);

    repository.alerts.set(activeAlertId, {
      id: activeAlertId,
      sourceReportId: "40000000-0000-4000-8000-000000000002",
      createdByOfficerId: officerId,
      hazardType: HazardType.FLOOD,
      severity: AlertSeverity.WARNING,
      message: "Ongoing active flood",
      safetyInstructions: "Stay indoors",
      status: AlertStatus.ACTIVE,
      version: 1,
      parentAlertId: null,
      targetZoneIds: [zone1],
      issuedAt: new Date("2026-10-06T10:00:00Z"),
      cancelledAt: null,
      cancellationReason: null,
    });

    const response = await request(app)
      .get(`/api/v1/alerts/${alertId}/similar-active`)
      .set("X-Dev-User-Id", officerId);

    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
  });

  it("returns empty array when no similar active alerts exist", async () => {
    const { app } = createBroadcastApp();
    await request(app)
      .post(`/api/v1/alerts/from-report/${reportId}`)
      .set("X-Dev-User-Id", officerId);

    await request(app)
      .patch(`/api/v1/alerts/${alertId}`)
      .set("X-Dev-User-Id", officerId)
      .send({
        severity: AlertSeverity.WARNING,
        message: "Flood warning.",
        safetyInstructions: "Evacuate.",
        targetZoneIds: [zone1],
      });

    const response = await request(app)
      .get(`/api/v1/alerts/${alertId}/similar-active`)
      .set("X-Dev-User-Id", officerId);

    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
  });

  it("returns 404 NOT_FOUND for unknown alertId", async () => {
    const { app } = createBroadcastApp();
    const response = await request(app)
      .get(`/api/v1/alerts/${unknownId}/similar-active`)
      .set("X-Dev-User-Id", officerId);

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("NOT_FOUND");
  });

  it("returns 404 NOT_FOUND for malformed non-uuid alertId", async () => {
    const { app } = createBroadcastApp();
    const response = await request(app)
      .get(`/api/v1/alerts/not-a-valid-uuid/similar-active`)
      .set("X-Dev-User-Id", officerId);

    expect(response.status).toBe(404);
  });

  it("returns 401 UNAUTHENTICATED when dev auth header is missing", async () => {
    const { app } = createBroadcastApp();
    const response = await request(app).get(`/api/v1/alerts/${alertId}/similar-active`);

    expect(response.status).toBe(401);
  });

  it("returns 403 FORBIDDEN when user has non-officer role (e.g. CITIZEN)", async () => {
    const { app } = createBroadcastApp();
    const response = await request(app)
      .get(`/api/v1/alerts/${alertId}/similar-active`)
      .set("X-Dev-User-Id", citizenId);

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("FORBIDDEN");
  });
});

describe("POST /api/v1/alerts/:alertId/broadcast", () => {
  const activeAlertId = "50000000-0000-4000-8000-000000000002";

  it("successfully activates a valid DRAFT alert and returns 200 OK with active alert and audit", async () => {
    const { app, repository } = createBroadcastApp();
    await request(app)
      .post(`/api/v1/alerts/from-report/${reportId}`)
      .set("X-Dev-User-Id", officerId);

    await request(app)
      .patch(`/api/v1/alerts/${alertId}`)
      .set("X-Dev-User-Id", officerId)
      .send({
        severity: AlertSeverity.WARNING,
        message: "Flood warning for low-lying areas.",
        safetyInstructions: "Evacuate immediately.",
        targetZoneIds: [zone1],
      });

    const response = await request(app)
      .post(`/api/v1/alerts/${alertId}/broadcast`)
      .set("X-Dev-User-Id", officerId)
      .set("Idempotency-Key", commandKey);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      alert: {
        id: alertId,
        severity: AlertSeverity.WARNING,
        message: "Flood warning for low-lying areas.",
        safetyInstructions: "Evacuate immediately.",
        status: AlertStatus.ACTIVE,
      },
      deliveries: [],
    });
    expect(response.body.alert.issuedAt).not.toBeNull();
    expect(repository.broadcastAudits).toHaveLength(1);
    expect(repository.broadcastAudits[0]?.action).toBe("ACTIVATED");
    expect(repository.broadcastAudits[0]?.officerId).toBe(officerId);
  });

  it("returns 403 FORBIDDEN when officer has canBroadcast=false", async () => {
    const { app } = createBroadcastApp();
    await request(app)
      .post(`/api/v1/alerts/from-report/${reportId}`)
      .set("X-Dev-User-Id", officerId);

    await request(app)
      .patch(`/api/v1/alerts/${alertId}`)
      .set("X-Dev-User-Id", officerId)
      .send({
        severity: AlertSeverity.WARNING,
        message: "Flood warning.",
        safetyInstructions: "Evacuate.",
        targetZoneIds: [zone1],
      });

    const response = await request(app)
      .post(`/api/v1/alerts/${alertId}/broadcast`)
      .set("X-Dev-User-Id", dutyOfficerWithoutBroadcast)
      .set("Idempotency-Key", commandKey);

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("FORBIDDEN");
  });

  it("returns 403 FORBIDDEN when user has non-officer role (e.g. CITIZEN)", async () => {
    const { app } = createBroadcastApp();
    const response = await request(app)
      .post(`/api/v1/alerts/${alertId}/broadcast`)
      .set("X-Dev-User-Id", citizenId)
      .set("Idempotency-Key", commandKey);

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("FORBIDDEN");
  });

  it("returns 401 UNAUTHENTICATED when dev auth header is missing", async () => {
    const { app } = createBroadcastApp();
    const response = await request(app)
      .post(`/api/v1/alerts/${alertId}/broadcast`)
      .set("Idempotency-Key", commandKey);

    expect(response.status).toBe(401);
  });

  it("returns 404 NOT_FOUND for unknown alertId", async () => {
    const { app } = createBroadcastApp();
    const response = await request(app)
      .post(`/api/v1/alerts/${unknownId}/broadcast`)
      .set("X-Dev-User-Id", officerId)
      .set("Idempotency-Key", commandKey);

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("NOT_FOUND");
  });

  it("returns 404 NOT_FOUND for malformed non-uuid alertId", async () => {
    const { app } = createBroadcastApp();
    const response = await request(app)
      .post(`/api/v1/alerts/not-a-valid-uuid/broadcast`)
      .set("X-Dev-User-Id", officerId)
      .set("Idempotency-Key", commandKey);

    expect(response.status).toBe(404);
  });

  it("returns 422 VALIDATION_ERROR when Idempotency-Key is not a valid UUID", async () => {
    const { app } = createBroadcastApp();
    const response = await request(app)
      .post(`/api/v1/alerts/${alertId}/broadcast`)
      .set("X-Dev-User-Id", officerId)
      .set("Idempotency-Key", "invalid-key");

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 409 ALERT_ALREADY_ACTIVE when attempting to broadcast an active alert", async () => {
    const { app } = createBroadcastApp();
    await request(app)
      .post(`/api/v1/alerts/from-report/${reportId}`)
      .set("X-Dev-User-Id", officerId);

    await request(app)
      .patch(`/api/v1/alerts/${alertId}`)
      .set("X-Dev-User-Id", officerId)
      .send({
        severity: AlertSeverity.WARNING,
        message: "Flood warning.",
        safetyInstructions: "Evacuate.",
        targetZoneIds: [zone1],
      });

    await request(app)
      .post(`/api/v1/alerts/${alertId}/broadcast`)
      .set("X-Dev-User-Id", officerId)
      .set("Idempotency-Key", commandKey);

    const secondResponse = await request(app)
      .post(`/api/v1/alerts/${alertId}/broadcast`)
      .set("X-Dev-User-Id", officerId)
      .set("Idempotency-Key", commandKey);

    expect(secondResponse.status).toBe(409);
    expect(secondResponse.body.error.code).toBe("ALERT_ALREADY_ACTIVE");
  });

  it("returns 409 SIMILAR_ALERT_ACTIVE when a similar active alert exists", async () => {
    const { app, repository } = createBroadcastApp();
    await request(app)
      .post(`/api/v1/alerts/from-report/${reportId}`)
      .set("X-Dev-User-Id", officerId);

    await request(app)
      .patch(`/api/v1/alerts/${alertId}`)
      .set("X-Dev-User-Id", officerId)
      .send({
        severity: AlertSeverity.WARNING,
        message: "Flood warning.",
        safetyInstructions: "Evacuate.",
        targetZoneIds: [zone1],
      });

    repository.alerts.set(activeAlertId, {
      id: activeAlertId,
      sourceReportId: "40000000-0000-4000-8000-000000000002",
      createdByOfficerId: officerId,
      hazardType: HazardType.FLOOD,
      severity: AlertSeverity.WARNING,
      message: "Ongoing active flood",
      safetyInstructions: "Stay indoors",
      status: AlertStatus.ACTIVE,
      version: 1,
      parentAlertId: null,
      targetZoneIds: [zone1],
      issuedAt: new Date("2026-10-06T10:00:00Z"),
      cancelledAt: null,
      cancellationReason: null,
    });

    const response = await request(app)
      .post(`/api/v1/alerts/${alertId}/broadcast`)
      .set("X-Dev-User-Id", officerId)
      .set("Idempotency-Key", commandKey);

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("SIMILAR_ALERT_ACTIVE");
  });

  it("returns 422 VALIDATION_ERROR when broadcasting an unedited draft with empty message and instructions", async () => {
    const { app } = createBroadcastApp();
    await request(app)
      .post(`/api/v1/alerts/from-report/${reportId}`)
      .set("X-Dev-User-Id", officerId);

    const response = await request(app)
      .post(`/api/v1/alerts/${alertId}/broadcast`)
      .set("X-Dev-User-Id", officerId)
      .set("Idempotency-Key", commandKey);

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });
});

describe("POST /api/v1/alerts/:alertId/replacement-drafts", () => {
  it("creates a new DRAFT replacement from an ACTIVE alert and returns 201 Created", async () => {
    const { app, repository } = createBroadcastApp();
    await request(app)
      .post(`/api/v1/alerts/from-report/${reportId}`)
      .set("X-Dev-User-Id", officerId);

    await request(app)
      .patch(`/api/v1/alerts/${alertId}`)
      .set("X-Dev-User-Id", officerId)
      .send({
        severity: AlertSeverity.WARNING,
        message: "Active flood warning.",
        safetyInstructions: "Move upstairs.",
        targetZoneIds: [zone1, zone2],
      });

    await request(app)
      .post(`/api/v1/alerts/${alertId}/broadcast`)
      .set("X-Dev-User-Id", officerId)
      .set("Idempotency-Key", commandKey);

    const response = await request(app)
      .post(`/api/v1/alerts/${alertId}/replacement-drafts`)
      .set("X-Dev-User-Id", officerId);

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      status: "DRAFT",
      parentAlertId: alertId,
      version: 2,
      sourceReportId: reportId,
      hazardType: "FLOOD",
      severity: "WARNING",
      message: "Active flood warning.",
      safetyInstructions: "Move upstairs.",
      createdByOfficerId: officerId,
      targetZoneIds: [zone1, zone2],
      issuedAt: null,
      cancelledAt: null,
      cancellationReason: null,
    });
    expect(response.body.id).toBeDefined();
    expect(response.body.id).not.toBe(alertId);

    // Parent alert remains ACTIVE with version 1
    const parent = await repository.findAlertById(alertId);
    expect(parent?.status).toBe(AlertStatus.ACTIVE);
    expect(parent?.version).toBe(1);

    // No audits or deliveries created for the replacement draft
    expect(repository.broadcastAudits).toHaveLength(1); // Only initial broadcast
    expect(repository.notificationDeliveries).toHaveLength(0);
  });

  it("returns 403 FORBIDDEN when duty officer has canBroadcast=false", async () => {
    const { app } = createBroadcastApp();
    await request(app)
      .post(`/api/v1/alerts/from-report/${reportId}`)
      .set("X-Dev-User-Id", officerId);

    await request(app)
      .patch(`/api/v1/alerts/${alertId}`)
      .set("X-Dev-User-Id", officerId)
      .send({
        severity: AlertSeverity.WARNING,
        message: "Active flood warning.",
        safetyInstructions: "Move upstairs.",
        targetZoneIds: [zone1],
      });

    await request(app)
      .post(`/api/v1/alerts/${alertId}/broadcast`)
      .set("X-Dev-User-Id", officerId)
      .set("Idempotency-Key", commandKey);

    const response = await request(app)
      .post(`/api/v1/alerts/${alertId}/replacement-drafts`)
      .set("X-Dev-User-Id", dutyOfficerWithoutBroadcast);

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("FORBIDDEN");
  });

  it("returns 403 FORBIDDEN when user is not a DMC duty officer", async () => {
    const { app } = createBroadcastApp();
    const response = await request(app)
      .post(`/api/v1/alerts/${alertId}/replacement-drafts`)
      .set("X-Dev-User-Id", citizenId);

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("FORBIDDEN");
  });

  it("returns 404 NOT_FOUND for unknown alert ID", async () => {
    const { app } = createBroadcastApp();
    const response = await request(app)
      .post(`/api/v1/alerts/${unknownId}/replacement-drafts`)
      .set("X-Dev-User-Id", officerId);

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("NOT_FOUND");
  });

  it("returns 404 NOT_FOUND for invalid UUID format", async () => {
    const { app } = createBroadcastApp();
    const response = await request(app)
      .post("/api/v1/alerts/invalid-uuid/replacement-drafts")
      .set("X-Dev-User-Id", officerId);

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("NOT_FOUND");
  });

  it("returns 409 ALERT_NOT_ACTIVE when parent alert is still in DRAFT", async () => {
    const { app } = createBroadcastApp();
    await request(app)
      .post(`/api/v1/alerts/from-report/${reportId}`)
      .set("X-Dev-User-Id", officerId);

    const response = await request(app)
      .post(`/api/v1/alerts/${alertId}/replacement-drafts`)
      .set("X-Dev-User-Id", officerId);

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("ALERT_NOT_ACTIVE");
  });

  it("returns 409 ALERT_NOT_ACTIVE when parent alert is CANCELLED", async () => {
    const { app, repository } = createBroadcastApp();
    await request(app)
      .post(`/api/v1/alerts/from-report/${reportId}`)
      .set("X-Dev-User-Id", officerId);

    const draft = await repository.findAlertById(alertId);
    repository.alerts.set(alertId, {
      ...draft!,
      status: AlertStatus.CANCELLED,
    });

    const response = await request(app)
      .post(`/api/v1/alerts/${alertId}/replacement-drafts`)
      .set("X-Dev-User-Id", officerId);

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("ALERT_NOT_ACTIVE");
  });
});

describe("POST /api/v1/alerts/:alertId/cancel", () => {
  const cancelReason = "Flood water level has completely normalized.";

  it("successfully cancels an ACTIVE alert and returns 200 with updated alert record", async () => {
    const { app, repository } = createBroadcastApp();
    await request(app)
      .post(`/api/v1/alerts/from-report/${reportId}`)
      .set("X-Dev-User-Id", officerId);

    await request(app)
      .patch(`/api/v1/alerts/${alertId}`)
      .set("X-Dev-User-Id", officerId)
      .send({
        severity: AlertSeverity.WARNING,
        message: "Flood warning in effect.",
        safetyInstructions: "Evacuate low lying areas.",
        targetZoneIds: [zone1],
      });

    await request(app).post(`/api/v1/alerts/${alertId}/broadcast`).set("X-Dev-User-Id", officerId);

    const response = await request(app)
      .post(`/api/v1/alerts/${alertId}/cancel`)
      .set("X-Dev-User-Id", officerId)
      .send({ reason: cancelReason });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      id: alertId,
      status: AlertStatus.CANCELLED,
      cancellationReason: cancelReason,
    });
    expect(response.body.cancelledAt).toBeTruthy();

    expect(repository.broadcastAudits).toHaveLength(2);
    expect(repository.broadcastAudits[1]).toMatchObject({
      alertId,
      officerId,
      action: "CANCELLED",
      reason: cancelReason,
    });
  });

  it("trims whitespace from cancellation reason", async () => {
    const { app } = createBroadcastApp();
    await request(app)
      .post(`/api/v1/alerts/from-report/${reportId}`)
      .set("X-Dev-User-Id", officerId);
    await request(app)
      .patch(`/api/v1/alerts/${alertId}`)
      .set("X-Dev-User-Id", officerId)
      .send({
        severity: AlertSeverity.WARNING,
        message: "Flood warning.",
        safetyInstructions: "Evacuate.",
        targetZoneIds: [zone1],
      });
    await request(app).post(`/api/v1/alerts/${alertId}/broadcast`).set("X-Dev-User-Id", officerId);

    const response = await request(app)
      .post(`/api/v1/alerts/${alertId}/cancel`)
      .set("X-Dev-User-Id", officerId)
      .send({ reason: `   ${cancelReason}   ` });

    expect(response.status).toBe(200);
    expect(response.body.cancellationReason).toBe(cancelReason);
  });

  it("accepts an optional Idempotency-Key header", async () => {
    const { app } = createBroadcastApp();
    await request(app)
      .post(`/api/v1/alerts/from-report/${reportId}`)
      .set("X-Dev-User-Id", officerId);
    await request(app)
      .patch(`/api/v1/alerts/${alertId}`)
      .set("X-Dev-User-Id", officerId)
      .send({
        severity: AlertSeverity.WARNING,
        message: "Flood warning.",
        safetyInstructions: "Evacuate.",
        targetZoneIds: [zone1],
      });
    await request(app).post(`/api/v1/alerts/${alertId}/broadcast`).set("X-Dev-User-Id", officerId);

    const response = await request(app)
      .post(`/api/v1/alerts/${alertId}/cancel`)
      .set("X-Dev-User-Id", officerId)
      .set("Idempotency-Key", "70000000-0000-4000-8000-000000000001")
      .send({ reason: cancelReason });

    expect(response.status).toBe(200);
  });

  it("rejects non-DMC_DUTY_OFFICER roles with 403 FORBIDDEN", async () => {
    const { app } = createBroadcastApp();
    const response = await request(app)
      .post(`/api/v1/alerts/${alertId}/cancel`)
      .set("X-Dev-User-Id", citizenId)
      .send({ reason: cancelReason });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("FORBIDDEN");
  });

  it("rejects DMC Duty Officer without broadcast permission with 403 FORBIDDEN", async () => {
    const { app } = createBroadcastApp();
    const response = await request(app)
      .post(`/api/v1/alerts/${alertId}/cancel`)
      .set("X-Dev-User-Id", dutyOfficerWithoutBroadcast)
      .send({ reason: cancelReason });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("FORBIDDEN");
  });

  it("returns 401 UNAUTHENTICATED when no authenticated user is present", async () => {
    const { app } = createBroadcastApp();
    const response = await request(app)
      .post(`/api/v1/alerts/${alertId}/cancel`)
      .send({ reason: cancelReason });

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("UNAUTHENTICATED");
  });

  it("returns 404 NOT_FOUND for invalid UUID format", async () => {
    const { app } = createBroadcastApp();
    const response = await request(app)
      .post("/api/v1/alerts/invalid-uuid/cancel")
      .set("X-Dev-User-Id", officerId)
      .send({ reason: cancelReason });

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("NOT_FOUND");
  });

  it("returns 404 NOT_FOUND when alert does not exist", async () => {
    const { app } = createBroadcastApp();
    const response = await request(app)
      .post(`/api/v1/alerts/${unknownId}/cancel`)
      .set("X-Dev-User-Id", officerId)
      .send({ reason: cancelReason });

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("NOT_FOUND");
  });

  it("returns 409 ALERT_NOT_ACTIVE when cancelling a DRAFT alert", async () => {
    const { app } = createBroadcastApp();
    await request(app)
      .post(`/api/v1/alerts/from-report/${reportId}`)
      .set("X-Dev-User-Id", officerId);

    const response = await request(app)
      .post(`/api/v1/alerts/${alertId}/cancel`)
      .set("X-Dev-User-Id", officerId)
      .send({ reason: cancelReason });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("ALERT_NOT_ACTIVE");
  });

  it("returns 409 ALERT_NOT_ACTIVE when cancelling a SUPERSEDED alert", async () => {
    const { app, repository } = createBroadcastApp();
    await request(app)
      .post(`/api/v1/alerts/from-report/${reportId}`)
      .set("X-Dev-User-Id", officerId);

    const draft = await repository.findAlertById(alertId);
    repository.alerts.set(alertId, {
      ...draft!,
      status: AlertStatus.SUPERSEDED,
    });

    const response = await request(app)
      .post(`/api/v1/alerts/${alertId}/cancel`)
      .set("X-Dev-User-Id", officerId)
      .send({ reason: cancelReason });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("ALERT_NOT_ACTIVE");
  });

  it("returns 409 ALERT_NOT_ACTIVE when cancelling an already CANCELLED alert", async () => {
    const { app, repository } = createBroadcastApp();
    await request(app)
      .post(`/api/v1/alerts/from-report/${reportId}`)
      .set("X-Dev-User-Id", officerId);

    const draft = await repository.findAlertById(alertId);
    repository.alerts.set(alertId, {
      ...draft!,
      status: AlertStatus.CANCELLED,
    });

    const response = await request(app)
      .post(`/api/v1/alerts/${alertId}/cancel`)
      .set("X-Dev-User-Id", officerId)
      .send({ reason: cancelReason });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("ALERT_NOT_ACTIVE");
  });

  it("returns 422 VALIDATION_ERROR when reason is missing", async () => {
    const { app } = createBroadcastApp();
    const response = await request(app)
      .post(`/api/v1/alerts/${alertId}/cancel`)
      .set("X-Dev-User-Id", officerId)
      .send({});

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 422 VALIDATION_ERROR when reason is blank / whitespace only", async () => {
    const { app } = createBroadcastApp();
    const response = await request(app)
      .post(`/api/v1/alerts/${alertId}/cancel`)
      .set("X-Dev-User-Id", officerId)
      .send({ reason: "          " });

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 422 VALIDATION_ERROR when reason is shorter than 10 characters", async () => {
    const { app } = createBroadcastApp();
    const response = await request(app)
      .post(`/api/v1/alerts/${alertId}/cancel`)
      .set("X-Dev-User-Id", officerId)
      .send({ reason: "Too short" });

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 422 VALIDATION_ERROR when reason exceeds 500 characters", async () => {
    const { app } = createBroadcastApp();
    const response = await request(app)
      .post(`/api/v1/alerts/${alertId}/cancel`)
      .set("X-Dev-User-Id", officerId)
      .send({ reason: "a".repeat(501) });

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });
});

describe("GET /api/v1/alerts/:alertId/deliveries & POST /api/v1/alerts/:alertId/deliveries/retry", () => {
  it("returns delivery tracking summary for an alert", async () => {
    const { app } = createBroadcastApp();
    await request(app)
      .post(`/api/v1/alerts/from-report/${reportId}`)
      .set("X-Dev-User-Id", officerId);

    const response = await request(app)
      .get(`/api/v1/alerts/${alertId}/deliveries`)
      .set("X-Dev-User-Id", officerId);

    expect(response.status).toBe(200);
    expect(response.body.alertId).toBe(alertId);
    expect(response.body.total).toBe(0);
    expect(response.body.pending).toBe(0);
  });

  it("retries eligible deliveries for an active alert", async () => {
    const { app } = createBroadcastApp();
    await request(app)
      .post(`/api/v1/alerts/from-report/${reportId}`)
      .set("X-Dev-User-Id", officerId);

    const response = await request(app)
      .post(`/api/v1/alerts/${alertId}/deliveries/retry`)
      .set("X-Dev-User-Id", officerId);

    expect(response.status).toBe(200);
    expect(response.body.alertId).toBe(alertId);
    expect(response.body.results).toBeInstanceOf(Array);
  });
});

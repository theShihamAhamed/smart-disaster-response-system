import { AlertSeverity, AlertStatus, DeliveryStatus, HazardType, ReportStatus, ZoneSeverity } from "@disaster/domain";
import { describe, expect, it } from "vitest";
import { HazardBroadcastService } from "./alert.service.js";
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
  TargetZoneSummary,
  UpdateDraftAlertCommand,
} from "./types.js";
import {
  AlertAlreadyActiveError,
  AlertNotActiveError,
  AlertNotFoundError,
  AlertNotInDraftError,
  ReportNotFoundError,
  ReportNotVerifiedError,
  SimilarAlertActiveError,
  ValidationError,
} from "./types.js";

const officerId = "10000000-0000-4000-8000-000000000004";
const reportId = "40000000-0000-4000-8000-000000000001";
const alertId = "50000000-0000-4000-8000-000000000001";
const fixedNow = new Date("2026-10-06T12:00:00Z");
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

class FakeHazardBroadcastRepository implements HazardBroadcastRepository {
  public createdAlerts: CreateInitialAlertCommand[] = [];
  public updatedCommands: UpdateDraftAlertCommand[] = [];
  public initialAlert: AlertRecord | null = null;
  public reportStatus: ReportStatus = ReportStatus.VERIFIED;
  public reportExists = true;
  public hazardType: HazardType = HazardType.FLOOD;
  public alerts: Map<string, AlertRecord> = new Map();
  public alertTargetZones: Map<string, TargetZoneSummary[]> = new Map();

  public async findSourceReport(id: string): Promise<SourceReport | null> {
    if (!this.reportExists || id !== reportId) return null;
    return {
      id: reportId,
      status: this.reportStatus,
      hazardType: this.hazardType,
    };
  }

  public async findAlertById(id: string): Promise<AlertRecord | null> {
    return this.alerts.get(id) ?? (this.initialAlert && this.initialAlert.id === id ? this.initialAlert : null);
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
    this.createdAlerts.push(command);
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
    this.updatedCommands.push(command);
    const current = this.alerts.get(command.alertId)!;
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
    const results: AlertRecord[] = [];
    for (const alert of this.alerts.values()) {
      if (query.excludeAlertId && alert.id === query.excludeAlertId) {
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

  public async createReplacementDraft(command: CreateReplacementDraftCommand): Promise<AlertRecord> {
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
}

describe("HazardBroadcastService - createAlertFromVerifiedReport", () => {
  it("creates an initial DRAFT alert for a VERIFIED hazard report", async () => {
    const repository = new FakeHazardBroadcastRepository();
    const service = new HazardBroadcastService(repository);

    const result = await service.createAlertFromVerifiedReport({ reportId, officerId });

    expect(result.isNew).toBe(true);
    expect(result.alert).toMatchObject({
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
    expect(repository.createdAlerts).toHaveLength(1);
  });

  it("rejects initial alert creation when report is PENDING", async () => {
    const repository = new FakeHazardBroadcastRepository();
    repository.reportStatus = ReportStatus.PENDING;
    const service = new HazardBroadcastService(repository);

    await expect(service.createAlertFromVerifiedReport({ reportId, officerId })).rejects.toThrow(
      ReportNotVerifiedError,
    );
    expect(repository.createdAlerts).toHaveLength(0);
  });

  it("rejects initial alert creation when report is REJECTED", async () => {
    const repository = new FakeHazardBroadcastRepository();
    repository.reportStatus = ReportStatus.REJECTED;
    const service = new HazardBroadcastService(repository);

    await expect(service.createAlertFromVerifiedReport({ reportId, officerId })).rejects.toThrow(
      ReportNotVerifiedError,
    );
    expect(repository.createdAlerts).toHaveLength(0);
  });

  it("throws ReportNotFoundError when the report does not exist", async () => {
    const repository = new FakeHazardBroadcastRepository();
    repository.reportExists = false;
    const service = new HazardBroadcastService(repository);

    await expect(service.createAlertFromVerifiedReport({ reportId, officerId })).rejects.toThrow(
      ReportNotFoundError,
    );
    expect(repository.createdAlerts).toHaveLength(0);
  });

  it("initializes Alert with status = DRAFT, version = 1, parentAlertId = null", async () => {
    const repository = new FakeHazardBroadcastRepository();
    const service = new HazardBroadcastService(repository);

    const { alert } = await service.createAlertFromVerifiedReport({ reportId, officerId });

    expect(alert.status).toBe(AlertStatus.DRAFT);
    expect(alert.version).toBe(1);
    expect(alert.parentAlertId).toBeNull();
  });

  it("inherits hazardType from the verified source report", async () => {
    const repository = new FakeHazardBroadcastRepository();
    repository.hazardType = HazardType.LANDSLIDE;
    const service = new HazardBroadcastService(repository);

    const { alert } = await service.createAlertFromVerifiedReport({ reportId, officerId });

    expect(alert.hazardType).toBe(HazardType.LANDSLIDE);
  });

  it("sets createdByOfficerId from the trusted authenticated officer identity", async () => {
    const repository = new FakeHazardBroadcastRepository();
    const service = new HazardBroadcastService(repository);

    const { alert } = await service.createAlertFromVerifiedReport({ reportId, officerId });

    expect(alert.createdByOfficerId).toBe(officerId);
    expect(repository.createdAlerts[0]?.createdByOfficerId).toBe(officerId);
  });

  it("returns existing initial Alert idempotently on repeated calls without creating another Alert", async () => {
    const repository = new FakeHazardBroadcastRepository();
    const service = new HazardBroadcastService(repository);

    const first = await service.createAlertFromVerifiedReport({ reportId, officerId });
    expect(first.isNew).toBe(true);

    const second = await service.createAlertFromVerifiedReport({ reportId, officerId });
    expect(second.isNew).toBe(false);
    expect(second.alert.id).toBe(first.alert.id);
    expect(repository.createdAlerts).toHaveLength(1);
  });

  it("never activates the alert (status remains DRAFT)", async () => {
    const repository = new FakeHazardBroadcastRepository();
    const service = new HazardBroadcastService(repository);

    const { alert } = await service.createAlertFromVerifiedReport({ reportId, officerId });

    expect(alert.status).toBe(AlertStatus.DRAFT);
    expect(alert.issuedAt).toBeNull();
  });

  it("does not modify the source report status", async () => {
    const repository = new FakeHazardBroadcastRepository();
    const service = new HazardBroadcastService(repository);

    await service.createAlertFromVerifiedReport({ reportId, officerId });

    expect(repository.reportStatus).toBe(ReportStatus.VERIFIED);
  });
});

describe("HazardBroadcastService - updateDraftAlert", () => {
  it("successfully edits a DRAFT alert updating severity, message, instructions and target zones", async () => {
    const repository = new FakeHazardBroadcastRepository();
    const service = new HazardBroadcastService(repository);
    await service.createAlertFromVerifiedReport({ reportId, officerId });

    const updated = await service.updateDraftAlert({
      alertId,
      severity: AlertSeverity.WARNING,
      message: "Severe flood water rising along Main Street.",
      safetyInstructions: "Evacuate to nearest shelter immediately.",
      targetZoneIds: [zone1, zone2],
    });

    expect(updated.id).toBe(alertId);
    expect(updated.status).toBe(AlertStatus.DRAFT);
    expect(updated.version).toBe(1);
    expect(updated.parentAlertId).toBeNull();
    expect(updated.severity).toBe(AlertSeverity.WARNING);
    expect(updated.message).toBe("Severe flood water rising along Main Street.");
    expect(updated.safetyInstructions).toBe("Evacuate to nearest shelter immediately.");
    expect(updated.targetZoneIds).toEqual([zone1, zone2]);
  });

  it("rejects blank or whitespace-only message", async () => {
    const repository = new FakeHazardBroadcastRepository();
    const service = new HazardBroadcastService(repository);
    await service.createAlertFromVerifiedReport({ reportId, officerId });

    await expect(
      service.updateDraftAlert({
        alertId,
        severity: AlertSeverity.WARNING,
        message: "   ",
        safetyInstructions: "Follow instructions.",
        targetZoneIds: [zone1],
      }),
    ).rejects.toThrow(ValidationError);
  });

  it("rejects blank or whitespace-only safety instructions", async () => {
    const repository = new FakeHazardBroadcastRepository();
    const service = new HazardBroadcastService(repository);
    await service.createAlertFromVerifiedReport({ reportId, officerId });

    await expect(
      service.updateDraftAlert({
        alertId,
        severity: AlertSeverity.WARNING,
        message: "Valid message.",
        safetyInstructions: "   ",
        targetZoneIds: [zone1],
      }),
    ).rejects.toThrow(ValidationError);
  });

  it("rejects message over 1000 characters", async () => {
    const repository = new FakeHazardBroadcastRepository();
    const service = new HazardBroadcastService(repository);
    await service.createAlertFromVerifiedReport({ reportId, officerId });

    await expect(
      service.updateDraftAlert({
        alertId,
        severity: AlertSeverity.WARNING,
        message: "a".repeat(1001),
        safetyInstructions: "Follow instructions.",
        targetZoneIds: [zone1],
      }),
    ).rejects.toThrow(ValidationError);
  });

  it("rejects safety instructions over 1000 characters", async () => {
    const repository = new FakeHazardBroadcastRepository();
    const service = new HazardBroadcastService(repository);
    await service.createAlertFromVerifiedReport({ reportId, officerId });

    await expect(
      service.updateDraftAlert({
        alertId,
        severity: AlertSeverity.WARNING,
        message: "Valid message.",
        safetyInstructions: "a".repeat(1001),
        targetZoneIds: [zone1],
      }),
    ).rejects.toThrow(ValidationError);
  });

  it("rejects empty target-zone list", async () => {
    const repository = new FakeHazardBroadcastRepository();
    const service = new HazardBroadcastService(repository);
    await service.createAlertFromVerifiedReport({ reportId, officerId });

    await expect(
      service.updateDraftAlert({
        alertId,
        severity: AlertSeverity.WARNING,
        message: "Valid message.",
        safetyInstructions: "Valid instructions.",
        targetZoneIds: [],
      }),
    ).rejects.toThrow(ValidationError);
  });

  it("throws AlertNotFoundError when alert does not exist", async () => {
    const repository = new FakeHazardBroadcastRepository();
    const service = new HazardBroadcastService(repository);

    await expect(
      service.updateDraftAlert({
        alertId: "50000000-0000-4000-8000-000000000099",
        severity: AlertSeverity.WARNING,
        message: "Valid message.",
        safetyInstructions: "Valid instructions.",
        targetZoneIds: [zone1],
      }),
    ).rejects.toThrow(AlertNotFoundError);
  });

  it("throws AlertNotInDraftError when alert is ACTIVE", async () => {
    const repository = new FakeHazardBroadcastRepository();
    const service = new HazardBroadcastService(repository);
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

    await expect(
      service.updateDraftAlert({
        alertId,
        severity: AlertSeverity.EVACUATION,
        message: "Updated message.",
        safetyInstructions: "Updated instructions.",
        targetZoneIds: [zone1],
      }),
    ).rejects.toThrow(AlertNotInDraftError);
  });

  it("does not create a new alert on update", async () => {
    const repository = new FakeHazardBroadcastRepository();
    const service = new HazardBroadcastService(repository);
    await service.createAlertFromVerifiedReport({ reportId, officerId });

    await service.updateDraftAlert({
      alertId,
      severity: AlertSeverity.EVACUATION,
      message: "Evacuation message.",
      safetyInstructions: "Evacuate immediately.",
      targetZoneIds: [zone1],
    });

    expect(repository.createdAlerts).toHaveLength(1);
    expect(repository.updatedCommands).toHaveLength(1);
  });
});

describe("HazardBroadcastService - getAlertPreview", () => {
  it("returns preview with alert details, target zones, and estimated recipient count", async () => {
    const repository = new FakeHazardBroadcastRepository();
    const service = new HazardBroadcastService(repository);
    await service.createAlertFromVerifiedReport({ reportId, officerId });
    await service.updateDraftAlert({
      alertId,
      severity: AlertSeverity.WARNING,
      message: "Heavy rain expected.",
      safetyInstructions: "Stay indoors.",
      targetZoneIds: [zone1, zone2],
    });

    const preview = await service.getAlertPreview(alertId);

    expect(preview.alert.id).toBe(alertId);
    expect(preview.alert.severity).toBe(AlertSeverity.WARNING);
    expect(preview.alert.message).toBe("Heavy rain expected.");
    expect(preview.alert.safetyInstructions).toBe("Stay indoors.");
    expect(preview.alert.status).toBe(AlertStatus.DRAFT);
    expect(preview.targetZones).toHaveLength(2);
    expect(preview.targetZones[0]?.id).toBe(zone1);
    expect(preview.targetZones[1]?.id).toBe(zone2);
    expect(preview.estimatedRecipients).toBe(0);
  });

  it("allows custom RecipientEstimator injection when provided", async () => {
    const repository = new FakeHazardBroadcastRepository();
    const customEstimator = (zones: readonly { id: string }[]) => zones.length * 10;
    const service = new HazardBroadcastService(repository, customEstimator);
    await service.createAlertFromVerifiedReport({ reportId, officerId });
    await service.updateDraftAlert({
      alertId,
      severity: AlertSeverity.WARNING,
      message: "Heavy rain expected.",
      safetyInstructions: "Stay indoors.",
      targetZoneIds: [zone1, zone2],
    });

    const preview = await service.getAlertPreview(alertId);
    expect(preview.estimatedRecipients).toBe(20);
  });

  it("returns estimatedRecipients = 0 when no target zones are attached", async () => {
    const repository = new FakeHazardBroadcastRepository();
    const service = new HazardBroadcastService(repository);
    await service.createAlertFromVerifiedReport({ reportId, officerId });

    const preview = await service.getAlertPreview(alertId);

    expect(preview.targetZones).toHaveLength(0);
    expect(preview.estimatedRecipients).toBe(0);
  });

  it("throws AlertNotFoundError when previewing a non-existent alert", async () => {
    const repository = new FakeHazardBroadcastRepository();
    const service = new HazardBroadcastService(repository);

    await expect(service.getAlertPreview("50000000-0000-4000-8000-000000000099")).rejects.toThrow(
      AlertNotFoundError,
    );
  });

  it("is strictly read-only: does not modify alert status, create delivery records, or change report status", async () => {
    const repository = new FakeHazardBroadcastRepository();
    const service = new HazardBroadcastService(repository);
    await service.createAlertFromVerifiedReport({ reportId, officerId });

    await service.getAlertPreview(alertId);

    const alert = await repository.findAlertById(alertId);
    expect(alert?.status).toBe(AlertStatus.DRAFT);
    expect(alert?.issuedAt).toBeNull();
    expect(repository.createdAlerts).toHaveLength(1);
    expect(repository.reportStatus).toBe(ReportStatus.VERIFIED);
  });
});

describe("HazardBroadcastService - findSimilarActiveAlerts", () => {
  const activeAlertId1 = "50000000-0000-4000-8000-000000000002";
  const activeAlertId2 = "50000000-0000-4000-8000-000000000003";

  it("returns matching ACTIVE alert when hazard type is the same and at least one target zone overlaps", async () => {
    const repository = new FakeHazardBroadcastRepository();
    const service = new HazardBroadcastService(repository);
    await service.createAlertFromVerifiedReport({ reportId, officerId });
    await service.updateDraftAlert({
      alertId,
      severity: AlertSeverity.WARNING,
      message: "Flood alert.",
      safetyInstructions: "Evacuate.",
      targetZoneIds: [zone1],
    });

    repository.alerts.set(activeAlertId1, {
      id: activeAlertId1,
      sourceReportId: "40000000-0000-4000-8000-000000000002",
      createdByOfficerId: officerId,
      hazardType: HazardType.FLOOD,
      severity: AlertSeverity.WARNING,
      message: "Ongoing flood",
      safetyInstructions: "Stay safe",
      status: AlertStatus.ACTIVE,
      version: 1,
      parentAlertId: null,
      targetZoneIds: [zone1, zone2],
      issuedAt: new Date("2026-10-06T10:00:00Z"),
      cancelledAt: null,
      cancellationReason: null,
    });

    const similar = await service.findSimilarActiveAlerts(alertId);

    expect(similar).toHaveLength(1);
    expect(similar[0]?.id).toBe(activeAlertId1);
    expect(similar[0]?.status).toBe(AlertStatus.ACTIVE);
  });

  it("does not return an ACTIVE alert when hazard type is different", async () => {
    const repository = new FakeHazardBroadcastRepository();
    const service = new HazardBroadcastService(repository);
    await service.createAlertFromVerifiedReport({ reportId, officerId });
    await service.updateDraftAlert({
      alertId,
      severity: AlertSeverity.WARNING,
      message: "Flood alert.",
      safetyInstructions: "Evacuate.",
      targetZoneIds: [zone1],
    });

    repository.alerts.set(activeAlertId1, {
      id: activeAlertId1,
      sourceReportId: "40000000-0000-4000-8000-000000000002",
      createdByOfficerId: officerId,
      hazardType: HazardType.CYCLONE,
      severity: AlertSeverity.WARNING,
      message: "Cyclone active",
      safetyInstructions: "Stay indoors",
      status: AlertStatus.ACTIVE,
      version: 1,
      parentAlertId: null,
      targetZoneIds: [zone1],
      issuedAt: new Date("2026-10-06T10:00:00Z"),
      cancelledAt: null,
      cancellationReason: null,
    });

    const similar = await service.findSimilarActiveAlerts(alertId);

    expect(similar).toEqual([]);
  });

  it("does not return an ACTIVE alert when there is no shared target zone", async () => {
    const repository = new FakeHazardBroadcastRepository();
    const service = new HazardBroadcastService(repository);
    await service.createAlertFromVerifiedReport({ reportId, officerId });
    await service.updateDraftAlert({
      alertId,
      severity: AlertSeverity.WARNING,
      message: "Flood alert.",
      safetyInstructions: "Evacuate.",
      targetZoneIds: [zone1],
    });

    repository.alerts.set(activeAlertId1, {
      id: activeAlertId1,
      sourceReportId: "40000000-0000-4000-8000-000000000002",
      createdByOfficerId: officerId,
      hazardType: HazardType.FLOOD,
      severity: AlertSeverity.WARNING,
      message: "Flood in other zone",
      safetyInstructions: "Stay safe",
      status: AlertStatus.ACTIVE,
      version: 1,
      parentAlertId: null,
      targetZoneIds: [zone2],
      issuedAt: new Date("2026-10-06T10:00:00Z"),
      cancelledAt: null,
      cancellationReason: null,
    });

    const similar = await service.findSimilarActiveAlerts(alertId);

    expect(similar).toEqual([]);
  });

  it("does not return other DRAFT alerts even with same hazard type and overlapping zones", async () => {
    const repository = new FakeHazardBroadcastRepository();
    const service = new HazardBroadcastService(repository);
    await service.createAlertFromVerifiedReport({ reportId, officerId });
    await service.updateDraftAlert({
      alertId,
      severity: AlertSeverity.WARNING,
      message: "Flood alert.",
      safetyInstructions: "Evacuate.",
      targetZoneIds: [zone1],
    });

    repository.alerts.set(activeAlertId1, {
      id: activeAlertId1,
      sourceReportId: "40000000-0000-4000-8000-000000000002",
      createdByOfficerId: officerId,
      hazardType: HazardType.FLOOD,
      severity: AlertSeverity.WARNING,
      message: "Another draft",
      safetyInstructions: "Stay safe",
      status: AlertStatus.DRAFT,
      version: 1,
      parentAlertId: null,
      targetZoneIds: [zone1],
      issuedAt: null,
      cancelledAt: null,
      cancellationReason: null,
    });

    const similar = await service.findSimilarActiveAlerts(alertId);

    expect(similar).toEqual([]);
  });

  it("does not return SUPERSEDED alerts", async () => {
    const repository = new FakeHazardBroadcastRepository();
    const service = new HazardBroadcastService(repository);
    await service.createAlertFromVerifiedReport({ reportId, officerId });
    await service.updateDraftAlert({
      alertId,
      severity: AlertSeverity.WARNING,
      message: "Flood alert.",
      safetyInstructions: "Evacuate.",
      targetZoneIds: [zone1],
    });

    repository.alerts.set(activeAlertId1, {
      id: activeAlertId1,
      sourceReportId: "40000000-0000-4000-8000-000000000002",
      createdByOfficerId: officerId,
      hazardType: HazardType.FLOOD,
      severity: AlertSeverity.WARNING,
      message: "Superseded flood alert",
      safetyInstructions: "Stay safe",
      status: AlertStatus.SUPERSEDED,
      version: 1,
      parentAlertId: null,
      targetZoneIds: [zone1],
      issuedAt: new Date("2026-10-05T10:00:00Z"),
      cancelledAt: null,
      cancellationReason: null,
    });

    const similar = await service.findSimilarActiveAlerts(alertId);

    expect(similar).toEqual([]);
  });

  it("does not return CANCELLED alerts", async () => {
    const repository = new FakeHazardBroadcastRepository();
    const service = new HazardBroadcastService(repository);
    await service.createAlertFromVerifiedReport({ reportId, officerId });
    await service.updateDraftAlert({
      alertId,
      severity: AlertSeverity.WARNING,
      message: "Flood alert.",
      safetyInstructions: "Evacuate.",
      targetZoneIds: [zone1],
    });

    repository.alerts.set(activeAlertId1, {
      id: activeAlertId1,
      sourceReportId: "40000000-0000-4000-8000-000000000002",
      createdByOfficerId: officerId,
      hazardType: HazardType.FLOOD,
      severity: AlertSeverity.WARNING,
      message: "Cancelled flood alert",
      safetyInstructions: "Stay safe",
      status: AlertStatus.CANCELLED,
      version: 1,
      parentAlertId: null,
      targetZoneIds: [zone1],
      issuedAt: new Date("2026-10-05T10:00:00Z"),
      cancelledAt: new Date("2026-10-06T10:00:00Z"),
      cancellationReason: "Receded",
    });

    const similar = await service.findSimilarActiveAlerts(alertId);

    expect(similar).toEqual([]);
  });

  it("returns multiple matching ACTIVE alerts if applicable", async () => {
    const repository = new FakeHazardBroadcastRepository();
    const service = new HazardBroadcastService(repository);
    await service.createAlertFromVerifiedReport({ reportId, officerId });
    await service.updateDraftAlert({
      alertId,
      severity: AlertSeverity.WARNING,
      message: "Flood alert.",
      safetyInstructions: "Evacuate.",
      targetZoneIds: [zone1, zone2],
    });

    repository.alerts.set(activeAlertId1, {
      id: activeAlertId1,
      sourceReportId: "40000000-0000-4000-8000-000000000002",
      createdByOfficerId: officerId,
      hazardType: HazardType.FLOOD,
      severity: AlertSeverity.WARNING,
      message: "Active flood 1",
      safetyInstructions: "Stay safe",
      status: AlertStatus.ACTIVE,
      version: 1,
      parentAlertId: null,
      targetZoneIds: [zone1],
      issuedAt: new Date("2026-10-06T10:00:00Z"),
      cancelledAt: null,
      cancellationReason: null,
    });

    repository.alerts.set(activeAlertId2, {
      id: activeAlertId2,
      sourceReportId: "40000000-0000-4000-8000-000000000003",
      createdByOfficerId: officerId,
      hazardType: HazardType.FLOOD,
      severity: AlertSeverity.EVACUATION,
      message: "Active flood 2",
      safetyInstructions: "Evacuate",
      status: AlertStatus.ACTIVE,
      version: 1,
      parentAlertId: null,
      targetZoneIds: [zone2],
      issuedAt: new Date("2026-10-06T11:00:00Z"),
      cancelledAt: null,
      cancellationReason: null,
    });

    const similar = await service.findSimilarActiveAlerts(alertId);

    expect(similar).toHaveLength(2);
    expect(similar.map((a) => a.id)).toEqual([activeAlertId1, activeAlertId2]);
  });

  it("returns empty list when there are no target zones attached to the draft", async () => {
    const repository = new FakeHazardBroadcastRepository();
    const service = new HazardBroadcastService(repository);
    await service.createAlertFromVerifiedReport({ reportId, officerId });

    repository.alerts.set(activeAlertId1, {
      id: activeAlertId1,
      sourceReportId: "40000000-0000-4000-8000-000000000002",
      createdByOfficerId: officerId,
      hazardType: HazardType.FLOOD,
      severity: AlertSeverity.WARNING,
      message: "Active flood",
      safetyInstructions: "Stay safe",
      status: AlertStatus.ACTIVE,
      version: 1,
      parentAlertId: null,
      targetZoneIds: [zone1],
      issuedAt: new Date("2026-10-06T10:00:00Z"),
      cancelledAt: null,
      cancellationReason: null,
    });

    const similar = await service.findSimilarActiveAlerts(alertId);

    expect(similar).toEqual([]);
  });

  it("returns empty list when no similar active alerts exist", async () => {
    const repository = new FakeHazardBroadcastRepository();
    const service = new HazardBroadcastService(repository);
    await service.createAlertFromVerifiedReport({ reportId, officerId });
    await service.updateDraftAlert({
      alertId,
      severity: AlertSeverity.WARNING,
      message: "Flood alert.",
      safetyInstructions: "Evacuate.",
      targetZoneIds: [zone1],
    });

    const similar = await service.findSimilarActiveAlerts(alertId);

    expect(similar).toEqual([]);
  });

  it("throws AlertNotFoundError when checking similar active for a non-existent alert", async () => {
    const repository = new FakeHazardBroadcastRepository();
    const service = new HazardBroadcastService(repository);

    await expect(
      service.findSimilarActiveAlerts("50000000-0000-4000-8000-000000000099"),
    ).rejects.toThrow(AlertNotFoundError);
  });

  it("is strictly read-only: does not modify draft or existing active alerts", async () => {
    const repository = new FakeHazardBroadcastRepository();
    const service = new HazardBroadcastService(repository);
    await service.createAlertFromVerifiedReport({ reportId, officerId });
    await service.updateDraftAlert({
      alertId,
      severity: AlertSeverity.WARNING,
      message: "Flood alert.",
      safetyInstructions: "Evacuate.",
      targetZoneIds: [zone1],
    });

    repository.alerts.set(activeAlertId1, {
      id: activeAlertId1,
      sourceReportId: "40000000-0000-4000-8000-000000000002",
      createdByOfficerId: officerId,
      hazardType: HazardType.FLOOD,
      severity: AlertSeverity.WARNING,
      message: "Active flood",
      safetyInstructions: "Stay safe",
      status: AlertStatus.ACTIVE,
      version: 1,
      parentAlertId: null,
      targetZoneIds: [zone1],
      issuedAt: new Date("2026-10-06T10:00:00Z"),
      cancelledAt: null,
      cancellationReason: null,
    });

    await service.findSimilarActiveAlerts(alertId);

    const draft = await repository.findAlertById(alertId);
    expect(draft?.status).toBe(AlertStatus.DRAFT);
    expect(draft?.issuedAt).toBeNull();

    const active = await repository.findAlertById(activeAlertId1);
    expect(active?.status).toBe(AlertStatus.ACTIVE);
  });
});

describe("HazardBroadcastService - broadcastAlert", () => {
  it("successfully activates a valid DRAFT alert and sets issuedAt and creates audit", async () => {
    const repository = new FakeHazardBroadcastRepository();
    const service = new HazardBroadcastService(repository, undefined, () => fixedNow);
    await service.createAlertFromVerifiedReport({ reportId, officerId });
    await service.updateDraftAlert({
      alertId,
      severity: AlertSeverity.WARNING,
      message: "Heavy rain and flood danger.",
      safetyInstructions: "Move to designated high ground.",
      targetZoneIds: [zone1],
    });

    const result = await service.broadcastAlert({ alertId, officerId });

    expect(result.alert.id).toBe(alertId);
    expect(result.alert.status).toBe(AlertStatus.ACTIVE);
    expect(result.alert.issuedAt).toEqual(fixedNow);
    expect(result.deliveries).toEqual([]);

    expect(repository.broadcastAudits).toHaveLength(1);
    expect(repository.broadcastAudits[0]).toEqual({
      alertId,
      officerId,
      action: "ACTIVATED",
      reason: null,
      createdAt: fixedNow,
    });
  });

  it("throws AlertAlreadyActiveError when attempting to broadcast an already ACTIVE alert", async () => {
    const repository = new FakeHazardBroadcastRepository();
    const service = new HazardBroadcastService(repository, undefined, () => fixedNow);
    await service.createAlertFromVerifiedReport({ reportId, officerId });
    await service.updateDraftAlert({
      alertId,
      severity: AlertSeverity.WARNING,
      message: "Heavy rain.",
      safetyInstructions: "Stay indoors.",
      targetZoneIds: [zone1],
    });
    await service.broadcastAlert({ alertId, officerId });

    await expect(service.broadcastAlert({ alertId, officerId })).rejects.toThrow(
      AlertAlreadyActiveError,
    );
  });

  it("throws SimilarAlertActiveError when an overlapping ACTIVE alert exists", async () => {
    const repository = new FakeHazardBroadcastRepository();
    const service = new HazardBroadcastService(repository, undefined, () => fixedNow);
    await service.createAlertFromVerifiedReport({ reportId, officerId });
    await service.updateDraftAlert({
      alertId,
      severity: AlertSeverity.WARNING,
      message: "New flood warning.",
      safetyInstructions: "Evacuate.",
      targetZoneIds: [zone1],
    });

    const activeAlertId = "50000000-0000-4000-8000-000000000002";
    repository.alerts.set(activeAlertId, {
      id: activeAlertId,
      sourceReportId: "40000000-0000-4000-8000-000000000002",
      createdByOfficerId: officerId,
      hazardType: HazardType.FLOOD,
      severity: AlertSeverity.WARNING,
      message: "Ongoing flood",
      safetyInstructions: "Stay safe",
      status: AlertStatus.ACTIVE,
      version: 1,
      parentAlertId: null,
      targetZoneIds: [zone1],
      issuedAt: new Date("2026-10-06T10:00:00Z"),
      cancelledAt: null,
      cancellationReason: null,
    });

    await expect(service.broadcastAlert({ alertId, officerId })).rejects.toThrow(
      SimilarAlertActiveError,
    );

    const draft = await repository.findAlertById(alertId);
    expect(draft?.status).toBe(AlertStatus.DRAFT);
    expect(draft?.issuedAt).toBeNull();
    expect(repository.broadcastAudits).toHaveLength(0);
  });

  it("rejects blank message with ValidationError and leaves alert as DRAFT", async () => {
    const repository = new FakeHazardBroadcastRepository();
    const service = new HazardBroadcastService(repository, undefined, () => fixedNow);
    await service.createAlertFromVerifiedReport({ reportId, officerId });
    // Alert was created with empty message
    await expect(service.broadcastAlert({ alertId, officerId })).rejects.toThrow(ValidationError);

    const draft = await repository.findAlertById(alertId);
    expect(draft?.status).toBe(AlertStatus.DRAFT);
  });

  it("rejects blank safety instructions with ValidationError and leaves alert as DRAFT", async () => {
    const repository = new FakeHazardBroadcastRepository();
    const service = new HazardBroadcastService(repository, undefined, () => fixedNow);
    await service.createAlertFromVerifiedReport({ reportId, officerId });
    // Set message but keep instructions empty in repository
    const draft = await repository.findAlertById(alertId);
    repository.alerts.set(alertId, {
      ...draft!,
      message: "Valid message",
      safetyInstructions: "",
      targetZoneIds: [zone1],
    });

    await expect(service.broadcastAlert({ alertId, officerId })).rejects.toThrow(ValidationError);
  });

  it("rejects zero target zones with ValidationError and leaves alert as DRAFT", async () => {
    const repository = new FakeHazardBroadcastRepository();
    const service = new HazardBroadcastService(repository, undefined, () => fixedNow);
    await service.createAlertFromVerifiedReport({ reportId, officerId });
    const draft = await repository.findAlertById(alertId);
    repository.alerts.set(alertId, {
      ...draft!,
      message: "Valid message",
      safetyInstructions: "Valid instructions",
      targetZoneIds: [],
    });

    await expect(service.broadcastAlert({ alertId, officerId })).rejects.toThrow(ValidationError);
  });

  it("throws AlertNotFoundError when broadcasting a non-existent alert", async () => {
    const repository = new FakeHazardBroadcastRepository();
    const service = new HazardBroadcastService(repository);

    await expect(
      service.broadcastAlert({
        alertId: "50000000-0000-4000-8000-000000000099",
        officerId,
      }),
    ).rejects.toThrow(AlertNotFoundError);
  });

  it("preserves source HazardReport status as VERIFIED", async () => {
    const repository = new FakeHazardBroadcastRepository();
    const service = new HazardBroadcastService(repository, undefined, () => fixedNow);
    await service.createAlertFromVerifiedReport({ reportId, officerId });
    await service.updateDraftAlert({
      alertId,
      severity: AlertSeverity.WARNING,
      message: "Heavy rain.",
      safetyInstructions: "Stay indoors.",
      targetZoneIds: [zone1],
    });
    await service.broadcastAlert({ alertId, officerId });

    expect(repository.reportStatus).toBe(ReportStatus.VERIFIED);
  });

  it("queues PENDING deliveries if a recipient resolver is provided", async () => {
    const repository = new FakeHazardBroadcastRepository();
    const resolver = async (zones: readonly string[]) => zones.map((z) => `recipient-for-${z}`);
    const service = new HazardBroadcastService(
      repository,
      undefined,
      () => fixedNow,
      resolver,
    );
    await service.createAlertFromVerifiedReport({ reportId, officerId });
    await service.updateDraftAlert({
      alertId,
      severity: AlertSeverity.WARNING,
      message: "Heavy rain.",
      safetyInstructions: "Stay indoors.",
      targetZoneIds: [zone1],
    });

    const result = await service.broadcastAlert({ alertId, officerId });
    expect(result.deliveries).toHaveLength(1);
    expect(result.deliveries[0]?.recipientRef).toBe(`recipient-for-${zone1}`);
    expect(result.deliveries[0]?.status).toBe(DeliveryStatus.PENDING);
    expect(result.deliveries[0]?.attemptNo).toBe(0);
  });
});

describe("HazardBroadcastService - createReplacementDraft", () => {
  it("creates a new DRAFT replacement from an ACTIVE alert with version + 1 and parentAlertId", async () => {
    const repository = new FakeHazardBroadcastRepository();
    const service = new HazardBroadcastService(repository, undefined, () => fixedNow);
    await service.createAlertFromVerifiedReport({ reportId, officerId });
    await service.updateDraftAlert({
      alertId,
      severity: AlertSeverity.WARNING,
      message: "Initial flood warning message.",
      safetyInstructions: "Move to higher ground immediately.",
      targetZoneIds: [zone1, zone2],
    });
    await service.broadcastAlert({ alertId, officerId });

    const newOfficerId = "10000000-0000-4000-8000-000000000099";
    const replacement = await service.createReplacementDraft({
      parentAlertId: alertId,
      officerId: newOfficerId,
    });

    expect(replacement.id).toBeDefined();
    expect(replacement.id).not.toBe(alertId);
    expect(replacement.parentAlertId).toBe(alertId);
    expect(replacement.version).toBe(2);
    expect(replacement.status).toBe(AlertStatus.DRAFT);
    expect(replacement.sourceReportId).toBe(reportId);
    expect(replacement.hazardType).toBe(HazardType.FLOOD);
    expect(replacement.severity).toBe(AlertSeverity.WARNING);
    expect(replacement.message).toBe("Initial flood warning message.");
    expect(replacement.safetyInstructions).toBe("Move to higher ground immediately.");
    expect(replacement.createdByOfficerId).toBe(newOfficerId);
    expect(replacement.targetZoneIds).toEqual([zone1, zone2]);
    expect(replacement.issuedAt).toBeNull();
    expect(replacement.cancelledAt).toBeNull();
    expect(replacement.cancellationReason).toBeNull();

    // Parent alert remains ACTIVE
    const parent = await repository.findAlertById(alertId);
    expect(parent?.status).toBe(AlertStatus.ACTIVE);
    expect(parent?.version).toBe(1);
    expect(parent?.parentAlertId).toBeNull();

    // No audits or deliveries created for the replacement draft
    expect(repository.broadcastAudits).toHaveLength(1); // Only the initial broadcast activation
    expect(repository.notificationDeliveries).toHaveLength(0);
  });

  it("throws AlertNotFoundError when parent alert does not exist", async () => {
    const repository = new FakeHazardBroadcastRepository();
    const service = new HazardBroadcastService(repository);

    await expect(
      service.createReplacementDraft({
        parentAlertId: "50000000-0000-4000-8000-000000000999",
        officerId,
      }),
    ).rejects.toThrow(AlertNotFoundError);
  });

  it("throws AlertNotActiveError when parent alert is in DRAFT", async () => {
    const repository = new FakeHazardBroadcastRepository();
    const service = new HazardBroadcastService(repository);
    await service.createAlertFromVerifiedReport({ reportId, officerId });

    await expect(
      service.createReplacementDraft({
        parentAlertId: alertId,
        officerId,
      }),
    ).rejects.toThrow(AlertNotActiveError);
  });

  it("throws AlertNotActiveError when parent alert is CANCELLED", async () => {
    const repository = new FakeHazardBroadcastRepository();
    const service = new HazardBroadcastService(repository);
    await service.createAlertFromVerifiedReport({ reportId, officerId });
    const draft = await repository.findAlertById(alertId);
    repository.alerts.set(alertId, {
      ...draft!,
      status: AlertStatus.CANCELLED,
    });

    await expect(
      service.createReplacementDraft({
        parentAlertId: alertId,
        officerId,
      }),
    ).rejects.toThrow(AlertNotActiveError);
  });

  it("throws AlertNotActiveError when parent alert is SUPERSEDED", async () => {
    const repository = new FakeHazardBroadcastRepository();
    const service = new HazardBroadcastService(repository);
    await service.createAlertFromVerifiedReport({ reportId, officerId });
    const draft = await repository.findAlertById(alertId);
    repository.alerts.set(alertId, {
      ...draft!,
      status: AlertStatus.SUPERSEDED,
    });

    await expect(
      service.createReplacementDraft({
        parentAlertId: alertId,
        officerId,
      }),
    ).rejects.toThrow(AlertNotActiveError);
  });
});

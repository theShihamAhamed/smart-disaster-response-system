import {
  AlertSeverity,
  AlertStatus,
  DeliveryStatus,
  HazardType,
  ReportStatus,
  ZoneSeverity,
} from "@disaster/domain";
import { describe, expect, it } from "vitest";
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
  PushGateway,
  SmsGateway,
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
    const excludeIds = query.excludeAlertIds ?? (query.excludeAlertId ? [query.excludeAlertId] : []);
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

  public async updateDelivery(
    command: UpdateDeliveryCommand,
  ): Promise<NotificationDeliveryRecord> {
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
    const service = new HazardBroadcastService(repository, undefined, () => fixedNow, resolver);
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

describe("HazardBroadcastService - cancelAlert", () => {
  const cancellationReason = "Flood waters have completely receded from the area.";

  it("successfully cancels an ACTIVE alert and sets status, timestamps, and reason", async () => {
    const repository = new FakeHazardBroadcastRepository();
    const service = new HazardBroadcastService(repository, undefined, () => fixedNow);
    await service.createAlertFromVerifiedReport({ reportId, officerId });
    await service.updateDraftAlert({
      alertId,
      severity: AlertSeverity.WARNING,
      message: "Water rising.",
      safetyInstructions: "Evacuate.",
      targetZoneIds: [zone1],
    });
    await service.broadcastAlert({ alertId, officerId });

    const cancelled = await service.cancelAlert({
      alertId,
      officerId,
      reason: cancellationReason,
    });

    expect(cancelled.status).toBe(AlertStatus.CANCELLED);
    expect(cancelled.cancelledAt).toEqual(fixedNow);
    expect(cancelled.cancellationReason).toBe(cancellationReason);

    expect(repository.broadcastAudits).toHaveLength(2);
    expect(repository.broadcastAudits[1]).toEqual({
      alertId,
      officerId,
      action: "CANCELLED",
      reason: cancellationReason,
      createdAt: fixedNow,
    });
  });

  it("trims whitespace from the cancellation reason", async () => {
    const repository = new FakeHazardBroadcastRepository();
    const service = new HazardBroadcastService(repository, undefined, () => fixedNow);
    await service.createAlertFromVerifiedReport({ reportId, officerId });
    await service.updateDraftAlert({
      alertId,
      severity: AlertSeverity.WARNING,
      message: "Water rising.",
      safetyInstructions: "Evacuate.",
      targetZoneIds: [zone1],
    });
    await service.broadcastAlert({ alertId, officerId });

    const cancelled = await service.cancelAlert({
      alertId,
      officerId,
      reason: `   ${cancellationReason}   `,
    });

    expect(cancelled.cancellationReason).toBe(cancellationReason);
  });

  it("throws AlertNotFoundError when alert does not exist", async () => {
    const repository = new FakeHazardBroadcastRepository();
    const service = new HazardBroadcastService(repository);

    await expect(
      service.cancelAlert({
        alertId: "99999999-9999-4999-8999-999999999999",
        officerId,
        reason: cancellationReason,
      }),
    ).rejects.toThrow(AlertNotFoundError);
  });

  it("throws AlertNotActiveError when cancelling a DRAFT alert", async () => {
    const repository = new FakeHazardBroadcastRepository();
    const service = new HazardBroadcastService(repository);
    await service.createAlertFromVerifiedReport({ reportId, officerId });

    await expect(
      service.cancelAlert({
        alertId,
        officerId,
        reason: cancellationReason,
      }),
    ).rejects.toThrow(AlertNotActiveError);
  });

  it("throws AlertNotActiveError when cancelling a SUPERSEDED alert", async () => {
    const repository = new FakeHazardBroadcastRepository();
    const service = new HazardBroadcastService(repository);
    await service.createAlertFromVerifiedReport({ reportId, officerId });
    const draft = await repository.findAlertById(alertId);
    repository.alerts.set(alertId, {
      ...draft!,
      status: AlertStatus.SUPERSEDED,
    });

    await expect(
      service.cancelAlert({
        alertId,
        officerId,
        reason: cancellationReason,
      }),
    ).rejects.toThrow(AlertNotActiveError);
  });

  it("throws AlertNotActiveError when cancelling an already CANCELLED alert", async () => {
    const repository = new FakeHazardBroadcastRepository();
    const service = new HazardBroadcastService(repository);
    await service.createAlertFromVerifiedReport({ reportId, officerId });
    const draft = await repository.findAlertById(alertId);
    repository.alerts.set(alertId, {
      ...draft!,
      status: AlertStatus.CANCELLED,
    });

    await expect(
      service.cancelAlert({
        alertId,
        officerId,
        reason: cancellationReason,
      }),
    ).rejects.toThrow(AlertNotActiveError);
  });

  it("throws ValidationError when reason is shorter than 10 characters after trimming", async () => {
    const repository = new FakeHazardBroadcastRepository();
    const service = new HazardBroadcastService(repository);
    await service.createAlertFromVerifiedReport({ reportId, officerId });
    await service.updateDraftAlert({
      alertId,
      severity: AlertSeverity.WARNING,
      message: "Water rising.",
      safetyInstructions: "Evacuate.",
      targetZoneIds: [zone1],
    });
    await service.broadcastAlert({ alertId, officerId });

    await expect(
      service.cancelAlert({
        alertId,
        officerId,
        reason: "Too short",
      }),
    ).rejects.toThrow(ValidationError);
  });

  it("throws ValidationError when reason exceeds 500 characters", async () => {
    const repository = new FakeHazardBroadcastRepository();
    const service = new HazardBroadcastService(repository);
    await service.createAlertFromVerifiedReport({ reportId, officerId });
    await service.updateDraftAlert({
      alertId,
      severity: AlertSeverity.WARNING,
      message: "Water rising.",
      safetyInstructions: "Evacuate.",
      targetZoneIds: [zone1],
    });
    await service.broadcastAlert({ alertId, officerId });

    await expect(
      service.cancelAlert({
        alertId,
        officerId,
        reason: "a".repeat(501),
      }),
    ).rejects.toThrow(ValidationError);
  });

  it("queues All Clear deliveries when a recipient resolver is provided", async () => {
    const repository = new FakeHazardBroadcastRepository();
    const resolver = async (zones: readonly string[]) => zones.map((z) => `all-clear-for-${z}`);
    const service = new HazardBroadcastService(repository, undefined, () => fixedNow, resolver);
    await service.createAlertFromVerifiedReport({ reportId, officerId });
    await service.updateDraftAlert({
      alertId,
      severity: AlertSeverity.WARNING,
      message: "Water rising.",
      safetyInstructions: "Evacuate.",
      targetZoneIds: [zone1],
    });
    await service.broadcastAlert({ alertId, officerId });

    const initialDeliveryCount = repository.notificationDeliveries.length;

    await service.cancelAlert({
      alertId,
      officerId,
      reason: cancellationReason,
    });

    expect(repository.notificationDeliveries.length).toBeGreaterThan(initialDeliveryCount);
    expect(repository.notificationDeliveries[initialDeliveryCount].recipientRef).toBe(
      `all-clear-for-${zone1}`,
    );
  });

  it("creates no notification deliveries when no recipient resolver is provided", async () => {
    const repository = new FakeHazardBroadcastRepository();
    const service = new HazardBroadcastService(repository, undefined, () => fixedNow);
    await service.createAlertFromVerifiedReport({ reportId, officerId });
    await service.updateDraftAlert({
      alertId,
      severity: AlertSeverity.WARNING,
      message: "Water rising.",
      safetyInstructions: "Evacuate.",
      targetZoneIds: [zone1],
    });
    await service.broadcastAlert({ alertId, officerId });

    expect(repository.notificationDeliveries).toHaveLength(0);

    await service.cancelAlert({
      alertId,
      officerId,
      reason: cancellationReason,
    });

    expect(repository.notificationDeliveries).toHaveLength(0);
  });
});

describe("HazardBroadcastService - delivery fallback orchestration (Step 10)", () => {
  it("processes delivery successfully on first Push attempt", async () => {
    let pushCalls = 0;
    let smsCalls = 0;
    const pushGateway: PushGateway = {
      sendPush: async () => {
        pushCalls++;
        return { success: true };
      },
    };
    const smsGateway: SmsGateway = {
      sendSms: async () => {
        smsCalls++;
        return { success: true };
      },
    };

    const repository = new FakeHazardBroadcastRepository();
    const resolver = async () => ["citizen-device-1"];
    const service = new HazardBroadcastService(
      repository,
      undefined,
      () => fixedNow,
      resolver,
      pushGateway,
      smsGateway,
    );

    await service.createAlertFromVerifiedReport({ reportId, officerId });
    await service.updateDraftAlert({
      alertId,
      severity: AlertSeverity.WARNING,
      message: "Flood alert.",
      safetyInstructions: "Stay safe.",
      targetZoneIds: [zone1],
    });

    const result = await service.broadcastAlert({ alertId, officerId });

    expect(pushCalls).toBe(1);
    expect(smsCalls).toBe(0);
    expect(result.deliveries).toHaveLength(1);
    expect(result.deliveries[0]).toMatchObject({
      recipientRef: "citizen-device-1",
      status: DeliveryStatus.PUSH_SENT,
      attemptNo: 1,
      lastFailureReason: null,
    });
  });

  it("retries Push once on initial failure and succeeds on 2nd Push attempt", async () => {
    let pushCalls = 0;
    let smsCalls = 0;
    const pushGateway: PushGateway = {
      sendPush: async () => {
        pushCalls++;
        if (pushCalls === 1) {
          return { success: false, error: "APNS device timeout" };
        }
        return { success: true };
      },
    };
    const smsGateway: SmsGateway = {
      sendSms: async () => {
        smsCalls++;
        return { success: true };
      },
    };

    const repository = new FakeHazardBroadcastRepository();
    const resolver = async () => ["citizen-device-2"];
    const service = new HazardBroadcastService(
      repository,
      undefined,
      () => fixedNow,
      resolver,
      pushGateway,
      smsGateway,
    );

    await service.createAlertFromVerifiedReport({ reportId, officerId });
    await service.updateDraftAlert({
      alertId,
      severity: AlertSeverity.WARNING,
      message: "Flood alert.",
      safetyInstructions: "Stay safe.",
      targetZoneIds: [zone1],
    });

    const result = await service.broadcastAlert({ alertId, officerId });

    expect(pushCalls).toBe(2);
    expect(smsCalls).toBe(0);
    expect(result.deliveries).toHaveLength(1);
    expect(result.deliveries[0]).toMatchObject({
      recipientRef: "citizen-device-2",
      status: DeliveryStatus.PUSH_SENT,
      attemptNo: 2,
      lastFailureReason: null,
    });
  });

  it("falls back to SMS when Push fails twice and marks SMS_SENT on SMS success", async () => {
    let pushCalls = 0;
    let smsCalls = 0;
    const pushGateway: PushGateway = {
      sendPush: async () => {
        pushCalls++;
        return { success: false, error: "FCM unreachable" };
      },
    };
    const smsGateway: SmsGateway = {
      sendSms: async () => {
        smsCalls++;
        return { success: true };
      },
    };

    const repository = new FakeHazardBroadcastRepository();
    const resolver = async () => ["citizen-phone-1"];
    const service = new HazardBroadcastService(
      repository,
      undefined,
      () => fixedNow,
      resolver,
      pushGateway,
      smsGateway,
    );

    await service.createAlertFromVerifiedReport({ reportId, officerId });
    await service.updateDraftAlert({
      alertId,
      severity: AlertSeverity.WARNING,
      message: "Flood alert.",
      safetyInstructions: "Stay safe.",
      targetZoneIds: [zone1],
    });

    const result = await service.broadcastAlert({ alertId, officerId });

    expect(pushCalls).toBe(2);
    expect(smsCalls).toBe(1);
    expect(result.deliveries).toHaveLength(1);
    expect(result.deliveries[0]).toMatchObject({
      recipientRef: "citizen-phone-1",
      status: DeliveryStatus.SMS_SENT,
      attemptNo: 3,
    });
  });

  it("marks FAILED_FINAL when both Push attempts and SMS fallback fail", async () => {
    let pushCalls = 0;
    let smsCalls = 0;
    const pushGateway: PushGateway = {
      sendPush: async () => {
        pushCalls++;
        return { success: false, error: "Push server 503" };
      },
    };
    const smsGateway: SmsGateway = {
      sendSms: async () => {
        smsCalls++;
        return { success: false, error: "SMS telco congestion" };
      },
    };

    const repository = new FakeHazardBroadcastRepository();
    const resolver = async () => ["citizen-contact-1"];
    const service = new HazardBroadcastService(
      repository,
      undefined,
      () => fixedNow,
      resolver,
      pushGateway,
      smsGateway,
    );

    await service.createAlertFromVerifiedReport({ reportId, officerId });
    await service.updateDraftAlert({
      alertId,
      severity: AlertSeverity.WARNING,
      message: "Flood alert.",
      safetyInstructions: "Stay safe.",
      targetZoneIds: [zone1],
    });

    const result = await service.broadcastAlert({ alertId, officerId });

    expect(pushCalls).toBe(2);
    expect(smsCalls).toBe(1);
    expect(result.deliveries).toHaveLength(1);
    expect(result.deliveries[0]).toMatchObject({
      recipientRef: "citizen-contact-1",
      status: DeliveryStatus.FAILED_FINAL,
      attemptNo: 3,
      lastFailureReason: "SMS telco congestion",
    });
  });

  it("keeps Alert status ACTIVE even when all delivery channels fail completely", async () => {
    const pushGateway: PushGateway = {
      sendPush: async () => ({ success: false, error: "Push failure" }),
    };
    const smsGateway: SmsGateway = {
      sendSms: async () => ({ success: false, error: "SMS failure" }),
    };

    const repository = new FakeHazardBroadcastRepository();
    const resolver = async () => ["recipient-x"];
    const service = new HazardBroadcastService(
      repository,
      undefined,
      () => fixedNow,
      resolver,
      pushGateway,
      smsGateway,
    );

    await service.createAlertFromVerifiedReport({ reportId, officerId });
    await service.updateDraftAlert({
      alertId,
      severity: AlertSeverity.WARNING,
      message: "Flood alert.",
      safetyInstructions: "Stay safe.",
      targetZoneIds: [zone1],
    });

    const result = await service.broadcastAlert({ alertId, officerId });

    expect(result.alert.status).toBe(AlertStatus.ACTIVE);
    expect(result.deliveries[0].status).toBe(DeliveryStatus.FAILED_FINAL);

    const storedAlert = await repository.findAlertById(alertId);
    expect(storedAlert?.status).toBe(AlertStatus.ACTIVE);
  });

  it("gracefully catches and handles gateway exceptions during Push and SMS dispatch", async () => {
    const pushGateway: PushGateway = {
      sendPush: async () => {
        throw new Error("Network connection dropped during Push");
      },
    };
    const smsGateway: SmsGateway = {
      sendSms: async () => {
        throw new Error("SMS socket timeout");
      },
    };

    const repository = new FakeHazardBroadcastRepository();
    const resolver = async () => ["recipient-throwing"];
    const service = new HazardBroadcastService(
      repository,
      undefined,
      () => fixedNow,
      resolver,
      pushGateway,
      smsGateway,
    );

    await service.createAlertFromVerifiedReport({ reportId, officerId });
    await service.updateDraftAlert({
      alertId,
      severity: AlertSeverity.WARNING,
      message: "Flood alert.",
      safetyInstructions: "Stay safe.",
      targetZoneIds: [zone1],
    });

    const result = await service.broadcastAlert({ alertId, officerId });

    expect(result.deliveries[0].status).toBe(DeliveryStatus.FAILED_FINAL);
    expect(result.deliveries[0].lastFailureReason).toBe("SMS socket timeout");
    expect(result.alert.status).toBe(AlertStatus.ACTIVE);
  });

  it("processes pending deliveries via processDeliveries method", async () => {
    const pushGateway: PushGateway = {
      sendPush: async () => ({ success: true }),
    };

    const repository = new FakeHazardBroadcastRepository();
    const resolver = async () => ["recipient-manual-1", "recipient-manual-2"];
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
      message: "Flood alert.",
      safetyInstructions: "Stay safe.",
      targetZoneIds: [zone1],
    });
    await service.broadcastAlert({ alertId, officerId });

    // Initial broadcast without gateways leaves them PENDING
    const initialDeliveries = await repository.findDeliveriesByAlertId(alertId);
    expect(initialDeliveries).toHaveLength(2);
    expect(initialDeliveries.every((d) => d.status === DeliveryStatus.PENDING)).toBe(true);

    const serviceWithGateways = new HazardBroadcastService(
      repository,
      undefined,
      () => fixedNow,
      undefined,
      pushGateway,
    );

    const processed = await serviceWithGateways.processDeliveries(alertId);
    expect(processed).toHaveLength(2);
    expect(processed.every((d) => d.status === DeliveryStatus.PUSH_SENT)).toBe(true);
  });
});

describe("HazardBroadcastService - delivery tracking and retry processing (Step 11)", () => {
  it("Test 1 & 6: Successful delivery is not retried (skipped with ALREADY_SUCCEEDED)", async () => {
    let pushCalls = 0;
    const pushGateway: PushGateway = {
      sendPush: async () => {
        pushCalls++;
        return { success: true };
      },
    };

    const repository = new FakeHazardBroadcastRepository();
    const resolver = async () => ["recipient-success-1"];
    const service = new HazardBroadcastService(
      repository,
      undefined,
      () => fixedNow,
      resolver,
      pushGateway,
    );

    await service.createAlertFromVerifiedReport({ reportId, officerId });
    await service.updateDraftAlert({
      alertId,
      severity: AlertSeverity.WARNING,
      message: "Flood alert.",
      safetyInstructions: "Stay safe.",
      targetZoneIds: [zone1],
    });

    const broadcastRes = await service.broadcastAlert({ alertId, officerId });
    const delivery = broadcastRes.deliveries[0];
    expect(delivery.status).toBe(DeliveryStatus.PUSH_SENT);
    expect(pushCalls).toBe(1);

    // Attempt retry on already successful delivery
    const retryRes = await service.retryDelivery(delivery.id);
    expect(retryRes.attempted).toBe(false);
    expect(retryRes.skippedReason).toBe("ALREADY_SUCCEEDED");
    expect(pushCalls).toBe(1); // Gateway not called again
  });

  it("Test 2: Retryable failure records failure and remains eligible for retry", async () => {
    let pushCalls = 0;
    const pushGateway: PushGateway = {
      sendPush: async () => {
        pushCalls++;
        return { success: false, error: "Network timeout" };
      },
    };

    const repository = new FakeHazardBroadcastRepository();
    const resolver = async () => ["recipient-fail-1"];
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
      message: "Flood alert.",
      safetyInstructions: "Stay safe.",
      targetZoneIds: [zone1],
    });

    await service.broadcastAlert({ alertId, officerId });
    const [initialDelivery] = await repository.findDeliveriesByAlertId(alertId);
    expect(initialDelivery.status).toBe(DeliveryStatus.PENDING);

    const serviceWithGateway = new HazardBroadcastService(
      repository,
      undefined,
      () => fixedNow,
      undefined,
      pushGateway,
    );

    // First attempt fails -> PUSH_FAILED (attempt 1)
    const retry1 = await serviceWithGateway.retryDelivery(initialDelivery.id);
    expect(retry1.attempted).toBe(true);
    expect(retry1.delivery.status).toBe(DeliveryStatus.PUSH_FAILED);
    expect(retry1.delivery.attemptNo).toBe(1);
    expect(retry1.delivery.lastFailureReason).toBe("Network timeout");
    expect(pushCalls).toBe(1);
  });

  it("Test 3: Retry succeeds on second attempt after first failure", async () => {
    let pushCalls = 0;
    const pushGateway: PushGateway = {
      sendPush: async () => {
        pushCalls++;
        if (pushCalls === 1) {
          return { success: false, error: "Temporary glitch" };
        }
        return { success: true };
      },
    };

    const repository = new FakeHazardBroadcastRepository();
    const resolver = async () => ["recipient-retry-success"];
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
      message: "Flood alert.",
      safetyInstructions: "Stay safe.",
      targetZoneIds: [zone1],
    });

    await service.broadcastAlert({ alertId, officerId });
    const [initialDelivery] = await repository.findDeliveriesByAlertId(alertId);

    const serviceWithGateway = new HazardBroadcastService(
      repository,
      undefined,
      () => fixedNow,
      undefined,
      pushGateway,
    );

    // First retry attempt -> PUSH_FAILED (attempt 1)
    const retry1 = await serviceWithGateway.retryDelivery(initialDelivery.id);
    expect(retry1.attempted).toBe(true);
    expect(retry1.delivery.status).toBe(DeliveryStatus.PUSH_FAILED);
    expect(retry1.delivery.attemptNo).toBe(1);

    // Second retry attempt -> PUSH_SENT (attempt 2)
    const retry2 = await serviceWithGateway.retryDelivery(initialDelivery.id);
    expect(retry2.attempted).toBe(true);
    expect(retry2.delivery.status).toBe(DeliveryStatus.PUSH_SENT);
    expect(retry2.delivery.attemptNo).toBe(2);
    expect(retry2.delivery.lastFailureReason).toBeNull();
  });

  it("Test 4 & 7: Maximum retry reached leads to FAILED_FINAL and further retries do nothing", async () => {
    let pushCalls = 0;
    let smsCalls = 0;
    const pushGateway: PushGateway = {
      sendPush: async () => {
        pushCalls++;
        return { success: false, error: "Push permanently dead" };
      },
    };
    const smsGateway: SmsGateway = {
      sendSms: async () => {
        smsCalls++;
        return { success: false, error: "SMS permanently dead" };
      },
    };

    const repository = new FakeHazardBroadcastRepository();
    const resolver = async () => ["recipient-max-fail"];
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
      message: "Flood alert.",
      safetyInstructions: "Stay safe.",
      targetZoneIds: [zone1],
    });

    await service.broadcastAlert({ alertId, officerId });
    const [initialDelivery] = await repository.findDeliveriesByAlertId(alertId);

    const serviceWithGateways = new HazardBroadcastService(
      repository,
      undefined,
      () => fixedNow,
      undefined,
      pushGateway,
      smsGateway,
    );

    // Attempt 1: Push fails -> PUSH_FAILED (attempt 1)
    const r1 = await serviceWithGateways.retryDelivery(initialDelivery.id);
    expect(r1.delivery.status).toBe(DeliveryStatus.PUSH_FAILED);
    expect(r1.delivery.attemptNo).toBe(1);

    // Attempt 2: Push retry fails -> SMS_FALLBACK_QUEUED (attempt 2)
    const r2 = await serviceWithGateways.retryDelivery(initialDelivery.id);
    expect(r2.delivery.status).toBe(DeliveryStatus.SMS_FALLBACK_QUEUED);
    expect(r2.delivery.attemptNo).toBe(2);

    // Attempt 3: SMS fails -> FAILED_FINAL (attempt 3)
    const r3 = await serviceWithGateways.retryDelivery(initialDelivery.id);
    expect(r3.delivery.status).toBe(DeliveryStatus.FAILED_FINAL);
    expect(r3.delivery.attemptNo).toBe(3);

    // Subsequent retry on FAILED_FINAL -> skipped with FINAL_FAILURE_REACHED
    const r4 = await serviceWithGateways.retryDelivery(initialDelivery.id);
    expect(r4.attempted).toBe(false);
    expect(r4.skippedReason).toBe("FINAL_FAILURE_REACHED");
    expect(pushCalls).toBe(2);
    expect(smsCalls).toBe(1);
  });

  it("Test 5: Retry before nextRetryAt (minRetryIntervalMs) is skipped", async () => {
    let pushCalls = 0;
    const pushGateway: PushGateway = {
      sendPush: async () => {
        pushCalls++;
        return { success: false, error: "Push busy" };
      },
    };

    let currentTime = new Date("2026-10-07T12:00:00.000Z");
    const repository = new FakeHazardBroadcastRepository();
    const resolver = async () => ["recipient-backoff"];
    const service = new HazardBroadcastService(
      repository,
      undefined,
      () => currentTime,
      resolver,
    );

    await service.createAlertFromVerifiedReport({ reportId, officerId });
    await service.updateDraftAlert({
      alertId,
      severity: AlertSeverity.WARNING,
      message: "Flood alert.",
      safetyInstructions: "Stay safe.",
      targetZoneIds: [zone1],
    });

    await service.broadcastAlert({ alertId, officerId });
    const [initialDelivery] = await repository.findDeliveriesByAlertId(alertId);

    const serviceWithGateway = new HazardBroadcastService(
      repository,
      undefined,
      () => currentTime,
      undefined,
      pushGateway,
    );

    // Attempt 1 at T=0ms
    const r1 = await serviceWithGateway.retryDelivery(initialDelivery.id, { minRetryIntervalMs: 5000 });
    expect(r1.attempted).toBe(true);
    expect(r1.delivery.status).toBe(DeliveryStatus.PUSH_FAILED);
    expect(pushCalls).toBe(1);

    // Attempt 2 at T=2000ms (too soon, within 5000ms window) -> skipped
    currentTime = new Date("2026-10-07T12:00:02.000Z");
    const r2 = await serviceWithGateway.retryDelivery(initialDelivery.id, { minRetryIntervalMs: 5000 });
    expect(r2.attempted).toBe(false);
    expect(r2.skippedReason).toBe("RETRY_NOT_DUE_YET");
    expect(pushCalls).toBe(1);

    // Attempt 3 at T=6000ms (window passed) -> processed
    currentTime = new Date("2026-10-07T12:00:06.000Z");
    const r3 = await serviceWithGateway.retryDelivery(initialDelivery.id, { minRetryIntervalMs: 5000 });
    expect(r3.attempted).toBe(true);
    expect(pushCalls).toBe(2);
  });

  it("Test 8: Duplicate concurrent retry processing on the same delivery is safely blocked", async () => {
    let pushCalls = 0;
    let resolvePush: (res: GatewayResult) => void;
    const slowPushPromise = new Promise<GatewayResult>((res) => {
      resolvePush = res;
    });

    const pushGateway: PushGateway = {
      sendPush: async () => {
        pushCalls++;
        return slowPushPromise;
      },
    };

    const repository = new FakeHazardBroadcastRepository();
    const resolver = async () => ["recipient-concurrent"];
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
      message: "Flood alert.",
      safetyInstructions: "Stay safe.",
      targetZoneIds: [zone1],
    });

    await service.broadcastAlert({ alertId, officerId });
    const [initialDelivery] = await repository.findDeliveriesByAlertId(alertId);

    const serviceWithGateway = new HazardBroadcastService(
      repository,
      undefined,
      () => fixedNow,
      undefined,
      pushGateway,
    );

    // Start first retry (slow)
    const retryPromise1 = serviceWithGateway.retryDelivery(initialDelivery.id);

    // Immediate second retry invocation while first is in-flight
    const retry2 = await serviceWithGateway.retryDelivery(initialDelivery.id);
    expect(retry2.attempted).toBe(false);
    expect(retry2.skippedReason).toBe("CONCURRENT_PROCESSING_BLOCKED");

    // Complete the first retry
    resolvePush!({ success: true });
    const retry1 = await retryPromise1;
    expect(retry1.attempted).toBe(true);
    expect(retry1.delivery.status).toBe(DeliveryStatus.PUSH_SENT);
    expect(pushCalls).toBe(1);
  });

  it("Test 10: Alert remains ACTIVE regardless of retry outcomes or final failure", async () => {
    const pushGateway: PushGateway = {
      sendPush: async () => ({ success: false, error: "Fatal Push" }),
    };
    const smsGateway: SmsGateway = {
      sendSms: async () => ({ success: false, error: "Fatal SMS" }),
    };

    const repository = new FakeHazardBroadcastRepository();
    const resolver = async () => ["recipient-active-isolation"];
    const service = new HazardBroadcastService(
      repository,
      undefined,
      () => fixedNow,
      resolver,
      pushGateway,
      smsGateway,
    );

    await service.createAlertFromVerifiedReport({ reportId, officerId });
    await service.updateDraftAlert({
      alertId,
      severity: AlertSeverity.WARNING,
      message: "Flood alert.",
      safetyInstructions: "Stay safe.",
      targetZoneIds: [zone1],
    });

    await service.broadcastAlert({ alertId, officerId });
    const [delivery] = await repository.findDeliveriesByAlertId(alertId);

    await service.retryDelivery(delivery.id);
    await service.retryDelivery(delivery.id);
    const finalRes = await service.retryDelivery(delivery.id);

    expect(finalRes.delivery.status).toBe(DeliveryStatus.FAILED_FINAL);

    const alert = await repository.findAlertById(alertId);
    expect(alert?.status).toBe(AlertStatus.ACTIVE);
  });

  it("Test 11: getDeliveryTracking calculates counts accurately", async () => {
    const repository = new FakeHazardBroadcastRepository();
    const resolver = async () => ["rec-1", "rec-2", "rec-3"];
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
      message: "Flood alert.",
      safetyInstructions: "Stay safe.",
      targetZoneIds: [zone1],
    });

    await service.broadcastAlert({ alertId, officerId });
    const trackingBefore = await service.getDeliveryTracking(alertId);
    expect(trackingBefore.total).toBe(3);
    expect(trackingBefore.pending).toBe(3);
    expect(trackingBefore.pushSent).toBe(0);

    // Update individual delivery statuses
    const deliveries = await repository.findDeliveriesByAlertId(alertId);
    await repository.updateDelivery({
      deliveryId: deliveries[0].id,
      status: DeliveryStatus.PUSH_SENT,
      attemptNo: 1,
      lastFailureReason: null,
      updatedAt: fixedNow,
    });
    await repository.updateDelivery({
      deliveryId: deliveries[1].id,
      status: DeliveryStatus.SMS_SENT,
      attemptNo: 3,
      lastFailureReason: "Push failed",
      updatedAt: fixedNow,
    });
    await repository.updateDelivery({
      deliveryId: deliveries[2].id,
      status: DeliveryStatus.FAILED_FINAL,
      attemptNo: 3,
      lastFailureReason: "All failed",
      updatedAt: fixedNow,
    });

    const trackingAfter = await service.getDeliveryTracking(alertId);
    expect(trackingAfter.total).toBe(3);
    expect(trackingAfter.pending).toBe(0);
    expect(trackingAfter.pushSent).toBe(1);
    expect(trackingAfter.smsSent).toBe(1);
    expect(trackingAfter.failedFinal).toBe(1);
  });

  it("Test 12: retryEligibleDeliveries processes only eligible deliveries in bulk", async () => {
    const pushGateway: PushGateway = {
      sendPush: async () => ({ success: true }),
    };

    const repository = new FakeHazardBroadcastRepository();
    const resolver = async () => ["bulk-1", "bulk-2"];
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
      message: "Flood alert.",
      safetyInstructions: "Stay safe.",
      targetZoneIds: [zone1],
    });
    await service.broadcastAlert({ alertId, officerId });

    const serviceWithGateway = new HazardBroadcastService(
      repository,
      undefined,
      () => fixedNow,
      undefined,
      pushGateway,
    );

    const retryResults = await serviceWithGateway.retryEligibleDeliveries(alertId);
    expect(retryResults).toHaveLength(2);
    expect(retryResults.every((r) => r.attempted === true)).toBe(true);
    expect(retryResults.every((r) => r.delivery.status === DeliveryStatus.PUSH_SENT)).toBe(true);
  });
});

describe("HazardBroadcastService - update / supersede workflow (Step 12)", () => {
  it("normal ordinary DRAFT without parentAlertId still activates normally", async () => {
    const repository = new FakeHazardBroadcastRepository();
    const service = new HazardBroadcastService(repository, undefined, () => fixedNow);
    await service.createAlertFromVerifiedReport({ reportId, officerId });
    await service.updateDraftAlert({
      alertId,
      severity: AlertSeverity.WARNING,
      message: "Flood warning.",
      safetyInstructions: "Move to high ground.",
      targetZoneIds: [zone1],
    });
    const res = await service.broadcastAlert({ alertId, officerId });
    expect(res.alert.status).toBe(AlertStatus.ACTIVE);
    expect(res.alert.parentAlertId).toBeNull();
  });

  it("creates replacement draft with version = parent.version + 1 and parentAlertId = parent.id", async () => {
    const repository = new FakeHazardBroadcastRepository();
    const service = new HazardBroadcastService(repository, undefined, () => fixedNow);
    await service.createAlertFromVerifiedReport({ reportId, officerId });
    await service.updateDraftAlert({
      alertId,
      severity: AlertSeverity.WARNING,
      message: "Flood warning.",
      safetyInstructions: "Move to high ground.",
      targetZoneIds: [zone1],
    });
    await service.broadcastAlert({ alertId, officerId });

    const replacement = await service.createReplacementDraft({
      parentAlertId: alertId,
      officerId,
    });

    expect(replacement.status).toBe(AlertStatus.DRAFT);
    expect(replacement.parentAlertId).toBe(alertId);
    expect(replacement.version).toBe(2);
    expect(replacement.hazardType).toBe(HazardType.FLOOD);
    expect(replacement.severity).toBe(AlertSeverity.WARNING);
    expect(replacement.message).toBe("Flood warning.");
  });

  it("activates replacement draft, marks parent SUPERSEDED, creates audits, and preserves delivery history", async () => {
    const repository = new FakeHazardBroadcastRepository();
    const resolver = async () => ["citizen-1"];
    const service = new HazardBroadcastService(repository, undefined, () => fixedNow, resolver);
    await service.createAlertFromVerifiedReport({ reportId, officerId });
    await service.updateDraftAlert({
      alertId,
      severity: AlertSeverity.WARNING,
      message: "Flood warning.",
      safetyInstructions: "Move to high ground.",
      targetZoneIds: [zone1],
    });
    await service.broadcastAlert({ alertId, officerId });

    const parentDeliveries = await repository.findDeliveriesByAlertId(alertId);
    expect(parentDeliveries).toHaveLength(1);
    expect(parentDeliveries[0].alertId).toBe(alertId);

    const replacementDraft = await service.createReplacementDraft({
      parentAlertId: alertId,
      officerId,
    });

    await service.updateDraftAlert({
      alertId: replacementDraft.id,
      severity: AlertSeverity.EVACUATION,
      message: "Evacuate immediately!",
      safetyInstructions: "Take essentials and follow evacuation routes.",
      targetZoneIds: [zone1, zone2],
    });

    const broadcastRes = await service.broadcastAlert({
      alertId: replacementDraft.id,
      officerId,
    });

    expect(broadcastRes.alert.status).toBe(AlertStatus.ACTIVE);
    expect(broadcastRes.alert.version).toBe(2);
    expect(broadcastRes.alert.severity).toBe(AlertSeverity.EVACUATION);

    const parentAlert = await repository.findAlertById(alertId);
    expect(parentAlert?.status).toBe(AlertStatus.SUPERSEDED);

    // Check audits
    const parentAudits = repository.broadcastAudits.filter((a) => a.alertId === alertId);
    expect(parentAudits.some((a) => a.action === "SUPERSEDED")).toBe(true);

    const replacementAudits = repository.broadcastAudits.filter((a) => a.alertId === replacementDraft.id);
    expect(replacementAudits.some((a) => a.action === "ACTIVATED")).toBe(true);

    // Check delivery isolation: parent deliveries unchanged, replacement has new deliveries
    const parentDeliveriesAfter = await repository.findDeliveriesByAlertId(alertId);
    expect(parentDeliveriesAfter).toHaveLength(1);
    expect(parentDeliveriesAfter[0].alertId).toBe(alertId);

    const replacementDeliveries = await repository.findDeliveriesByAlertId(replacementDraft.id);
    expect(replacementDeliveries).toHaveLength(1);
    expect(replacementDeliveries[0].alertId).toBe(replacementDraft.id);
  });

  it("rejects replacement creation from non-ACTIVE alert", async () => {
    const repository = new FakeHazardBroadcastRepository();
    const service = new HazardBroadcastService(repository, undefined, () => fixedNow);
    await service.createAlertFromVerifiedReport({ reportId, officerId });

    // Draft alert cannot be superseded
    await expect(
      service.createReplacementDraft({ parentAlertId: alertId, officerId }),
    ).rejects.toThrow(AlertNotActiveError);
  });

  it("rejects replacement activation if parent is already SUPERSEDED or CANCELLED", async () => {
    const repository = new FakeHazardBroadcastRepository();
    const service = new HazardBroadcastService(repository, undefined, () => fixedNow);
    await service.createAlertFromVerifiedReport({ reportId, officerId });
    await service.updateDraftAlert({
      alertId,
      severity: AlertSeverity.WARNING,
      message: "Flood warning.",
      safetyInstructions: "Move to high ground.",
      targetZoneIds: [zone1],
    });
    await service.broadcastAlert({ alertId, officerId });

    const replacement1 = await service.createReplacementDraft({
      parentAlertId: alertId,
      officerId,
    });
    const replacement2 = await service.createReplacementDraft({
      parentAlertId: alertId,
      officerId,
    });

    // Activate replacement 1
    await service.broadcastAlert({ alertId: replacement1.id, officerId });

    // Parent is now SUPERSEDED. Activating replacement 2 must fail!
    await expect(
      service.broadcastAlert({ alertId: replacement2.id, officerId }),
    ).rejects.toThrow(AlertNotActiveError);
  });

  describe("Step 13: Cancel Active Alert and All Clear", () => {
    it("cancels an ACTIVE alert, updates status, sets cancelledAt and cancellationReason", async () => {
      const repository = new FakeHazardBroadcastRepository();
      const service = new HazardBroadcastService(
        repository,
        undefined,
        () => fixedNow,
        async () => ["citizen-alpha", "citizen-beta"],
      );

      await service.createAlertFromVerifiedReport({ reportId, officerId });
      await service.updateDraftAlert({
        alertId,
        severity: AlertSeverity.CRITICAL,
        message: "Severe flood warning.",
        safetyInstructions: "Evacuate immediately.",
        targetZoneIds: [zone1],
      });
      await service.broadcastAlert({ alertId, officerId });

      const cancelled = await service.cancelAlert({
        alertId,
        officerId,
        reason: "Flood waters have receded completely and all roads are open.",
      });

      expect(cancelled.id).toBe(alertId);
      expect(cancelled.status).toBe(AlertStatus.CANCELLED);
      expect(cancelled.cancelledAt).toEqual(fixedNow);
      expect(cancelled.cancellationReason).toBe(
        "Flood waters have receded completely and all roads are open.",
      );

      const audits = repository.broadcastAudits.filter(
        (a) => a.alertId === alertId && a.action === "CANCELLED",
      );
      expect(audits).toHaveLength(1);
      expect(audits[0].officerId).toBe(officerId);
      expect(audits[0].reason).toBe("Flood waters have receded completely and all roads are open.");
      expect(audits[0].createdAt).toEqual(fixedNow);
    });

    it("rejects cancellation if reason is shorter than 10 characters or longer than 500 characters", async () => {
      const repository = new FakeHazardBroadcastRepository();
      const service = new HazardBroadcastService(repository, undefined, () => fixedNow);

      await service.createAlertFromVerifiedReport({ reportId, officerId });
      await service.updateDraftAlert({
        alertId,
        severity: AlertSeverity.CRITICAL,
        message: "Severe flood warning.",
        safetyInstructions: "Evacuate immediately.",
        targetZoneIds: [zone1],
      });
      await service.broadcastAlert({ alertId, officerId });

      await expect(
        service.cancelAlert({ alertId, officerId, reason: "Too short" }),
      ).rejects.toThrow("Cancellation reason must be at least 10 characters.");

      const tooLong = "A".repeat(501);
      await expect(
        service.cancelAlert({ alertId, officerId, reason: tooLong }),
      ).rejects.toThrow("Cancellation reason cannot exceed 500 characters.");
    });

    it("rejects cancellation of a DRAFT alert", async () => {
      const repository = new FakeHazardBroadcastRepository();
      const service = new HazardBroadcastService(repository, undefined, () => fixedNow);

      await service.createAlertFromVerifiedReport({ reportId, officerId });

      await expect(
        service.cancelAlert({
          alertId,
          officerId,
          reason: "Attempting to cancel draft directly.",
        }),
      ).rejects.toThrow(AlertNotActiveError);
    });

    it("rejects cancellation of a SUPERSEDED alert", async () => {
      const repository = new FakeHazardBroadcastRepository();
      const service = new HazardBroadcastService(repository, undefined, () => fixedNow);

      await service.createAlertFromVerifiedReport({ reportId, officerId });
      await service.updateDraftAlert({
        alertId,
        severity: AlertSeverity.WARNING,
        message: "Initial warning.",
        safetyInstructions: "Prepare sandbags.",
        targetZoneIds: [zone1],
      });
      await service.broadcastAlert({ alertId, officerId });

      const replacement = await service.createReplacementDraft({
        parentAlertId: alertId,
        officerId,
      });
      await service.broadcastAlert({ alertId: replacement.id, officerId });

      // Parent is now SUPERSEDED
      await expect(
        service.cancelAlert({
          alertId,
          officerId,
          reason: "Trying to cancel superseded parent.",
        }),
      ).rejects.toThrow(AlertNotActiveError);
    });

    it("rejects cancellation of an already CANCELLED alert", async () => {
      const repository = new FakeHazardBroadcastRepository();
      const service = new HazardBroadcastService(repository, undefined, () => fixedNow);

      await service.createAlertFromVerifiedReport({ reportId, officerId });
      await service.updateDraftAlert({
        alertId,
        severity: AlertSeverity.CRITICAL,
        message: "Flood warning.",
        safetyInstructions: "Move to high ground.",
        targetZoneIds: [zone1],
      });
      await service.broadcastAlert({ alertId, officerId });

      await service.cancelAlert({
        alertId,
        officerId,
        reason: "All clear - water has receded.",
      });

      // Second attempt must fail
      await expect(
        service.cancelAlert({
          alertId,
          officerId,
          reason: "Second cancellation attempt.",
        }),
      ).rejects.toThrow(AlertNotActiveError);
    });

    it("creates All Clear deliveries for target-zone recipients and preserves prior delivery history", async () => {
      const repository = new FakeHazardBroadcastRepository();
      const service = new HazardBroadcastService(
        repository,
        undefined,
        () => fixedNow,
        async () => ["recipient-1", "recipient-2"],
      );

      await service.createAlertFromVerifiedReport({ reportId, officerId });
      await service.updateDraftAlert({
        alertId,
        severity: AlertSeverity.CRITICAL,
        message: "Flood warning.",
        safetyInstructions: "Move to high ground.",
        targetZoneIds: [zone1],
      });
      await service.broadcastAlert({ alertId, officerId });

      // Simulate first broadcast delivery succeeded
      const initialDeliveries = await repository.findDeliveriesByAlertId(alertId);
      expect(initialDeliveries).toHaveLength(2);
      await repository.updateDelivery({
        deliveryId: initialDeliveries[0].id,
        status: DeliveryStatus.PUSH_SENT,
        attemptNo: 1,
        lastFailureReason: null,
        updatedAt: fixedNow,
      });

      // Cancel alert -> creates All Clear delivery records
      await service.cancelAlert({
        alertId,
        officerId,
        reason: "Flood situation has completely de-escalated.",
      });

      const allDeliveries = await repository.findDeliveriesByAlertId(alertId);
      expect(allDeliveries).toHaveLength(4);

      // Verify prior delivery was not mutated
      const priorDelivery = allDeliveries.find((d) => d.id === initialDeliveries[0].id);
      expect(priorDelivery?.status).toBe(DeliveryStatus.PUSH_SENT);
      expect(priorDelivery?.attemptNo).toBe(1);

      // Verify new All Clear deliveries
      const newAllClearDeliveries = allDeliveries.filter(
        (d) => d.id !== initialDeliveries[0].id && d.id !== initialDeliveries[1].id,
      );
      expect(newAllClearDeliveries).toHaveLength(2);
      for (const d of newAllClearDeliveries) {
        expect(d.status).toBe(DeliveryStatus.PENDING);
        expect(d.attemptNo).toBe(0);
        expect(d.alertId).toBe(alertId);
      }
    });

    it("delivers All Clear payload containing cancellation reason when All Clear delivery is processed", async () => {
      const repository = new FakeHazardBroadcastRepository();
      const pushCalls: Array<{ recipient: string; payload: unknown }> = [];
      const fakePushGateway = {
        sendPush: async (recipient: string, payload: unknown) => {
          pushCalls.push({ recipient, payload });
          return { success: true };
        },
      };

      const service = new HazardBroadcastService(
        repository,
        undefined,
        () => fixedNow,
        async () => ["recipient-1"],
        fakePushGateway,
      );

      await service.createAlertFromVerifiedReport({ reportId, officerId });
      await service.updateDraftAlert({
        alertId,
        severity: AlertSeverity.CRITICAL,
        message: "Emergency Flood Alert.",
        safetyInstructions: "Seek immediate shelter.",
        targetZoneIds: [zone1],
      });
      await service.broadcastAlert({ alertId, officerId });

      await service.cancelAlert({
        alertId,
        officerId,
        reason: "Flood waters subsided safely. Safe to return home.",
      });

      const deliveries = await repository.findDeliveriesByAlertId(alertId);
      const allClearDelivery = deliveries[deliveries.length - 1];

      const retryResult = await service.retryDelivery(allClearDelivery.id);
      expect(retryResult.attempted).toBe(true);
      expect(retryResult.delivery.status).toBe(DeliveryStatus.PUSH_SENT);

      expect(pushCalls).toHaveLength(2);
      const initialPayload = pushCalls[0].payload as any;
      expect(initialPayload.message).toBe("Emergency Flood Alert.");

      const lastPayload = pushCalls[1].payload as any;
      expect(lastPayload.message).toContain("[ALL CLEAR]");
      expect(lastPayload.message).toContain("Flood waters subsided safely. Safe to return home.");
      expect(lastPayload.safetyInstructions).toBe("The hazard situation has ended. All clear.");
    });
  });
});

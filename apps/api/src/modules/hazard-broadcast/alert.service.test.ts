import { AlertSeverity, AlertStatus, HazardType, ReportStatus } from "@disaster/domain";
import { describe, expect, it } from "vitest";
import { HazardBroadcastService } from "./alert.service.js";
import type {
  AlertRecord,
  CreateAlertPersistenceResult,
  CreateInitialAlertCommand,
  HazardBroadcastRepository,
  SourceReport,
} from "./types.js";
import { ReportNotFoundError, ReportNotVerifiedError } from "./types.js";

const officerId = "10000000-0000-4000-8000-000000000004";
const reportId = "40000000-0000-4000-8000-000000000001";
const alertId = "50000000-0000-4000-8000-000000000001";

class FakeHazardBroadcastRepository implements HazardBroadcastRepository {
  public createdAlerts: CreateInitialAlertCommand[] = [];
  public initialAlert: AlertRecord | null = null;
  public reportStatus: ReportStatus = ReportStatus.VERIFIED;
  public reportExists = true;
  public hazardType: HazardType = HazardType.FLOOD;
  public reports: Map<string, SourceReport> = new Map();

  public async findSourceReport(id: string): Promise<SourceReport | null> {
    if (!this.reportExists || id !== reportId) return null;
    return {
      id: reportId,
      status: this.reportStatus,
      hazardType: this.hazardType,
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
    return { kind: "CREATED", alert: created };
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

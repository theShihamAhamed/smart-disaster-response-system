import { randomUUID } from "node:crypto";
import { AlertStatus, DeliveryStatus } from "@disaster/domain";
import { Prisma, type PrismaClient } from "@prisma/client";
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
  AlertNotFoundError,
  AlertNotInDraftError,
} from "./types.js";

const sourceReportSelect = {
  id: true,
  status: true,
  hazardType: true,
} as const;

const alertSelect = {
  id: true,
  sourceReportId: true,
  createdByOfficerId: true,
  hazardType: true,
  severity: true,
  message: true,
  safetyInstructions: true,
  status: true,
  version: true,
  parentAlertId: true,
  issuedAt: true,
  cancelledAt: true,
  cancellationReason: true,
  targetZones: {
    select: {
      targetZoneId: true,
    },
  },
} as const;

const targetZoneSelect = {
  id: true,
  name: true,
  districtId: true,
  severity: true,
  geometryRef: true,
} as const;

type PrismaAlertWithZones = Prisma.AlertGetPayload<{
  select: typeof alertSelect;
}>;

function mapAlertRecord(alert: PrismaAlertWithZones): AlertRecord {
  return {
    id: alert.id,
    sourceReportId: alert.sourceReportId,
    createdByOfficerId: alert.createdByOfficerId,
    hazardType: alert.hazardType,
    severity: alert.severity,
    message: alert.message,
    safetyInstructions: alert.safetyInstructions,
    status: alert.status,
    version: alert.version,
    parentAlertId: alert.parentAlertId,
    issuedAt: alert.issuedAt,
    cancelledAt: alert.cancelledAt,
    cancellationReason: alert.cancellationReason,
    targetZoneIds: alert.targetZones.map((tz) => tz.targetZoneId),
  };
}

export class PrismaHazardBroadcastRepository implements HazardBroadcastRepository {
  public constructor(
    private readonly prisma: Pick<
      PrismaClient,
      | "hazardReport"
      | "alert"
      | "alertTargetZone"
      | "broadcastAudit"
      | "notificationDelivery"
      | "$transaction"
    >,
  ) {}

  public async findSourceReport(reportId: string): Promise<SourceReport | null> {
    return this.prisma.hazardReport.findUnique({
      where: { id: reportId },
      select: sourceReportSelect,
    });
  }

  public async findAlertById(alertId: string): Promise<AlertRecord | null> {
    const alert = await this.prisma.alert.findUnique({
      where: { id: alertId },
      select: alertSelect,
    });

    return alert ? mapAlertRecord(alert) : null;
  }

  public async findInitialAlertForReport(reportId: string): Promise<AlertRecord | null> {
    const alert = await this.prisma.alert.findFirst({
      where: {
        sourceReportId: reportId,
        parentAlertId: null,
      },
      select: alertSelect,
    });

    return alert ? mapAlertRecord(alert) : null;
  }

  public async findAlertPreview(alertId: string): Promise<AlertPreviewData | null> {
    const alert = await this.prisma.alert.findUnique({
      where: { id: alertId },
      select: {
        ...alertSelect,
        targetZones: {
          select: {
            targetZone: {
              select: targetZoneSelect,
            },
          },
        },
      },
    });

    if (!alert) return null;

    const targetZones: TargetZoneSummary[] = alert.targetZones.map((tz) => tz.targetZone);
    const alertRecord = mapAlertRecord({
      ...alert,
      targetZones: alert.targetZones.map((tz) => ({ targetZoneId: tz.targetZone.id })),
    });

    return {
      alert: alertRecord,
      targetZones,
    };
  }

  public async findSimilarActiveAlerts(
    query: FindSimilarActiveAlertsQuery,
  ): Promise<AlertRecord[]> {
    if (query.targetZoneIds.length === 0) {
      return [];
    }

    const alerts = await this.prisma.alert.findMany({
      where: {
        status: AlertStatus.ACTIVE,
        hazardType: query.hazardType,
        ...(query.excludeAlertId ? { id: { not: query.excludeAlertId } } : {}),
        targetZones: {
          some: {
            targetZoneId: {
              in: [...query.targetZoneIds],
            },
          },
        },
      },
      select: alertSelect,
      orderBy: {
        issuedAt: "desc",
      },
    });

    return alerts.map(mapAlertRecord);
  }

  public async createInitialAlert(
    command: CreateInitialAlertCommand,
  ): Promise<CreateAlertPersistenceResult> {
    const existing = await this.findInitialAlertForReport(command.sourceReportId);
    if (existing) {
      return { kind: "EXISTING", alert: existing };
    }

    try {
      const created = await this.prisma.alert.create({
        data: {
          id: randomUUID(),
          sourceReportId: command.sourceReportId,
          createdByOfficerId: command.createdByOfficerId,
          hazardType: command.hazardType,
          severity: command.severity,
          message: command.message,
          safetyInstructions: command.safetyInstructions,
          status: command.status,
          version: command.version,
          parentAlertId: null,
        },
        select: alertSelect,
      });

      return { kind: "CREATED", alert: mapAlertRecord(created) };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const concurrentAlert = await this.findInitialAlertForReport(command.sourceReportId);
        if (concurrentAlert) {
          return { kind: "EXISTING", alert: concurrentAlert };
        }
      }
      throw error;
    }
  }

  public async updateDraftAlert(command: UpdateDraftAlertCommand): Promise<AlertRecord> {
    return this.prisma.$transaction(async (tx) => {
      await tx.alert.update({
        where: { id: command.alertId },
        data: {
          severity: command.severity,
          message: command.message,
          safetyInstructions: command.safetyInstructions,
        },
      });

      await tx.alertTargetZone.deleteMany({
        where: { alertId: command.alertId },
      });

      if (command.targetZoneIds.length > 0) {
        await tx.alertTargetZone.createMany({
          data: command.targetZoneIds.map((targetZoneId) => ({
            alertId: command.alertId,
            targetZoneId,
          })),
        });
      }

      const updated = await tx.alert.findUniqueOrThrow({
        where: { id: command.alertId },
        select: alertSelect,
      });

      return mapAlertRecord(updated);
    });
  }

  public async activateAlert(command: ActivateAlertCommand): Promise<BroadcastAlertResult> {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.alert.findUnique({
        where: { id: command.alertId },
        select: alertSelect,
      });

      if (!current) {
        throw new AlertNotFoundError(command.alertId);
      }

      if (current.status === AlertStatus.ACTIVE) {
        throw new AlertAlreadyActiveError(current.status);
      }

      if (current.status !== AlertStatus.DRAFT) {
        throw new AlertNotInDraftError(current.status);
      }

      const updated = await tx.alert.update({
        where: {
          id: command.alertId,
          status: AlertStatus.DRAFT,
        },
        data: {
          status: AlertStatus.ACTIVE,
          issuedAt: command.issuedAt,
        },
        select: alertSelect,
      });

      await tx.broadcastAudit.create({
        data: {
          id: randomUUID(),
          alertId: command.alertId,
          officerId: command.officerId,
          action: "ACTIVATED",
          reason: command.reason ?? null,
          createdAt: command.issuedAt,
        },
      });

      const deliveries: NotificationDeliveryRecord[] = [];
      if (command.recipientRefs && command.recipientRefs.length > 0) {
        for (const recipientRef of command.recipientRefs) {
          const delivery = await tx.notificationDelivery.create({
            data: {
              id: randomUUID(),
              alertId: command.alertId,
              recipientRef,
              status: DeliveryStatus.PENDING,
              attemptNo: 0,
              lastFailureReason: null,
              updatedAt: command.issuedAt,
            },
          });
          deliveries.push({
            id: delivery.id,
            alertId: delivery.alertId,
            recipientRef: delivery.recipientRef,
            status: delivery.status,
            attemptNo: delivery.attemptNo,
            lastFailureReason: delivery.lastFailureReason,
            updatedAt: delivery.updatedAt,
          });
        }
      }

      return {
        alert: mapAlertRecord(updated),
        deliveries,
      };
    });
  }

  public async createReplacementDraft(
    command: CreateReplacementDraftCommand,
  ): Promise<AlertRecord> {
    return this.prisma.$transaction(async (tx) => {
      const newAlertId = randomUUID();
      await tx.alert.create({
        data: {
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
          issuedAt: null,
          cancelledAt: null,
          cancellationReason: null,
        },
        select: alertSelect,
      });

      if (command.targetZoneIds.length > 0) {
        await tx.alertTargetZone.createMany({
          data: command.targetZoneIds.map((targetZoneId) => ({
            alertId: newAlertId,
            targetZoneId,
          })),
        });
      }

      const result = await tx.alert.findUniqueOrThrow({
        where: { id: newAlertId },
        select: alertSelect,
      });

      return mapAlertRecord(result);
    });
  }
}

import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import type {
  AlertRecord,
  CreateAlertPersistenceResult,
  CreateInitialAlertCommand,
  HazardBroadcastRepository,
  SourceReport,
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
    private readonly prisma: Pick<PrismaClient, "hazardReport" | "alert">,
  ) {}

  public async findSourceReport(reportId: string): Promise<SourceReport | null> {
    return this.prisma.hazardReport.findUnique({
      where: { id: reportId },
      select: sourceReportSelect,
    });
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
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        const concurrentAlert = await this.findInitialAlertForReport(command.sourceReportId);
        if (concurrentAlert) {
          return { kind: "EXISTING", alert: concurrentAlert };
        }
      }
      throw error;
    }
  }
}

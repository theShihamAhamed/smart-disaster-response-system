import { randomUUID } from "node:crypto";
import { ReportStatus, type PrismaClient } from "@prisma/client";
import type {
  DecisionCommand,
  DecisionPersistenceResult,
  HazardVerificationRepository,
  PendingReport,
  ReportForReview,
} from "./types.js";

const pendingReportSelect = {
  id: true,
  status: true,
  hazardType: true,
  submittedAt: true,
  requiresExtraReview: true,
} as const;

const reviewReportSelect = {
  ...pendingReportSelect,
  description: true,
  photoRef: true,
  location: {
    select: {
      latitude: true,
      longitude: true,
      districtId: true,
      address: true,
      source: true,
    },
  },
} as const;

export class PrismaHazardVerificationRepository implements HazardVerificationRepository {
  public constructor(
    private readonly prisma: Pick<
      PrismaClient,
      "hazardReport" | "verificationDecision" | "$transaction"
    >,
  ) {}

  public async listPendingReports(): Promise<readonly PendingReport[]> {
    return this.prisma.hazardReport.findMany({
      where: { status: ReportStatus.PENDING },
      select: pendingReportSelect,
      orderBy: { submittedAt: "desc" },
    });
  }

  public async findReportForReview(reportId: string): Promise<ReportForReview | null> {
    const report = await this.prisma.hazardReport.findUnique({
      where: { id: reportId },
      select: reviewReportSelect,
    });

    if (!report) {
      return null;
    }

    return {
      ...report,
      location: {
        ...report.location,
        latitude: Number(report.location.latitude),
        longitude: Number(report.location.longitude),
      },
    };
  }

  public async decidePendingReport(command: DecisionCommand): Promise<DecisionPersistenceResult> {
    return this.prisma.$transaction(async (transaction) => {
      const transition = await transaction.hazardReport.updateMany({
        where: { id: command.reportId, status: ReportStatus.PENDING },
        data: { status: command.result },
      });

      if (transition.count === 0) {
        const report = await transaction.hazardReport.findUnique({
          where: { id: command.reportId },
          select: { status: true },
        });
        return report
          ? { kind: "REPORT_ALREADY_PROCESSED" as const, status: report.status }
          : { kind: "REPORT_NOT_FOUND" as const };
      }

      const decision = await transaction.verificationDecision.create({
        data: {
          id: randomUUID(),
          reportId: command.reportId,
          officerId: command.officerId,
          result: command.result,
          reason: command.reason ?? null,
          decidedAt: command.decidedAt,
        },
      });
      return { kind: "DECIDED" as const, decision };
    });
  }
}

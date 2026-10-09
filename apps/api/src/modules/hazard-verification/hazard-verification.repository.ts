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
  verificationDecision: {
    select: { result: true },
  },
} as const;

function reportStatusForDecision(result: "VERIFIED" | "REJECTED"): ReportStatus {
  return result === "VERIFIED" ? ReportStatus.VERIFIED : ReportStatus.REJECTED;
}

function isVerificationDecisionReportIdUniqueViolation(error: unknown): boolean {
  if (
    typeof error !== "object" ||
    error === null ||
    !("code" in error) ||
    error.code !== "P2002" ||
    !("meta" in error) ||
    typeof error.meta !== "object" ||
    error.meta === null ||
    !("target" in error.meta)
  ) {
    return false;
  }

  const target = error.meta.target;
  const targets = Array.isArray(target) ? target : [target];
  return targets.some(
    (value) => value === "reportId" || value === "VerificationDecision_reportId_key",
  );
}

export class PrismaHazardVerificationRepository implements HazardVerificationRepository {
  public constructor(
    private readonly prisma: Pick<
      PrismaClient,
      "hazardReport" | "verificationDecision" | "$transaction"
    >,
  ) {}

  public async listPendingReports(): Promise<readonly PendingReport[]> {
    return this.prisma.hazardReport.findMany({
      where: { status: ReportStatus.PENDING, verificationDecision: { is: null } },
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

    const { verificationDecision, ...review } = report;
    return {
      ...review,
      status: verificationDecision
        ? reportStatusForDecision(verificationDecision.result)
        : report.status,
      location: {
        ...report.location,
        latitude: Number(report.location.latitude),
        longitude: Number(report.location.longitude),
      },
    };
  }

  public async decidePendingReport(command: DecisionCommand): Promise<DecisionPersistenceResult> {
    try {
      return await this.prisma.$transaction(async (transaction) => {
        const current = await transaction.hazardReport.findUnique({
          where: { id: command.reportId },
          select: {
            status: true,
            verificationDecision: { select: { result: true } },
          },
        });

        if (!current) {
          return { kind: "REPORT_NOT_FOUND" as const };
        }
        if (current.status !== ReportStatus.PENDING) {
          return { kind: "REPORT_ALREADY_PROCESSED" as const, status: current.status };
        }
        if (current.verificationDecision) {
          return {
            kind: "REPORT_ALREADY_PROCESSED" as const,
            status: reportStatusForDecision(current.verificationDecision.result),
          };
        }

        const transition = await transaction.hazardReport.updateMany({
          where: { id: command.reportId, status: ReportStatus.PENDING },
          data: { status: command.result },
        });

        if (transition.count === 0) {
          const report = await transaction.hazardReport.findUnique({
            where: { id: command.reportId },
            select: {
              status: true,
              verificationDecision: { select: { result: true } },
            },
          });
          if (!report) {
            return { kind: "REPORT_NOT_FOUND" as const };
          }
          return {
            kind: "REPORT_ALREADY_PROCESSED" as const,
            status: report.verificationDecision
              ? reportStatusForDecision(report.verificationDecision.result)
              : report.status,
          };
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
    } catch (error) {
      if (!isVerificationDecisionReportIdUniqueViolation(error)) {
        throw error;
      }

      const existingDecision = await this.prisma.verificationDecision.findUnique({
        where: { reportId: command.reportId },
        select: { result: true },
      });
      return {
        kind: "REPORT_ALREADY_PROCESSED",
        // A relevant P2002 guarantees the one-decision invariant won the race. The lookup
        // supplies the winner's final result; the command result is only a safe fallback.
        status: existingDecision
          ? reportStatusForDecision(existingDecision.result)
          : reportStatusForDecision(command.result),
      };
    }
  }
}

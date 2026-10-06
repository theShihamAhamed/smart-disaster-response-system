import { ReportStatus, type PrismaClient } from "@prisma/client";
import type { HazardVerificationRepository, PendingReport, ReportForReview } from "./types.js";

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
  public constructor(private readonly prisma: Pick<PrismaClient, "hazardReport">) {}

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
}

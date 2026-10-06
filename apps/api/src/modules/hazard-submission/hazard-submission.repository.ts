import type { PrismaClient } from "@prisma/client";
import type {
  CreateReportResult,
  HazardReportRecord,
  HazardSubmissionRepository,
  NewHazardReport,
} from "./types.js";

interface ReportRow {
  readonly id: string;
  readonly clientReportId: string;
  readonly reporterId: string;
  readonly hazardType: HazardReportRecord["hazardType"];
  readonly status: HazardReportRecord["status"];
  readonly outsideAssignedArea: boolean;
  readonly requiresExtraReview: boolean;
  readonly submittedAt: Date;
  readonly verificationDecision: { readonly result: string; readonly reason: string | null } | null;
}

function toRecord(row: ReportRow): HazardReportRecord {
  const decision = row.verificationDecision;
  return {
    id: row.id,
    clientReportId: row.clientReportId,
    reporterId: row.reporterId,
    hazardType: row.hazardType,
    status: row.status,
    outsideAssignedArea: row.outsideAssignedArea,
    requiresExtraReview: row.requiresExtraReview,
    submittedAt: row.submittedAt,
    rejectionReason: decision?.result === "REJECTED" ? decision.reason : null,
  };
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

export class PrismaHazardSubmissionRepository implements HazardSubmissionRepository {
  public constructor(private readonly prisma: PrismaClient) {}

  public async findById(id: string): Promise<HazardReportRecord | null> {
    const row = await this.prisma.hazardReport.findUnique({
      where: { id },
      include: { verificationDecision: true },
    });
    return row ? toRecord(row) : null;
  }

  public async findByClientReportId(clientReportId: string): Promise<HazardReportRecord | null> {
    const row = await this.prisma.hazardReport.findUnique({
      where: { clientReportId },
      include: { verificationDecision: true },
    });
    return row ? toRecord(row) : null;
  }

  public async create(report: NewHazardReport): Promise<CreateReportResult> {
    try {
      // One nested write = one transaction: the report and its location are saved together or not at all.
      const row = await this.prisma.hazardReport.create({
        data: {
          id: report.id,
          clientReportId: report.clientReportId,
          reporter: { connect: { id: report.reporterId } },
          hazardType: report.hazardType,
          description: report.description,
          photoRef: report.photoRef,
          submittedAt: report.submittedAt,
          status: "PENDING",
          outsideAssignedArea: report.outsideAssignedArea,
          requiresExtraReview: report.requiresExtraReview,
          location: { create: report.location },
        },
        include: { verificationDecision: true },
      });
      return { record: toRecord(row), created: true };
    } catch (error) {
      // Two requests with the same clientReportId raced: the database UNIQUE index let only one win.
      if (isUniqueViolation(error)) {
        const existing = await this.findByClientReportId(report.clientReportId);
        if (existing) {
          return { record: existing, created: false };
        }
      }
      throw error;
    }
  }
}

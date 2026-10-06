import type { HazardType, LocationSource, ReportStatus } from "@disaster/domain";

export interface PendingReport {
  readonly id: string;
  readonly status: ReportStatus;
  readonly hazardType: HazardType;
  readonly submittedAt: Date;
  readonly requiresExtraReview: boolean;
}

export interface ReportReviewLocation {
  readonly latitude: number;
  readonly longitude: number;
  readonly districtId: string;
  readonly address: string | null;
  readonly source: LocationSource;
}

export interface ReportForReview extends PendingReport {
  readonly description: string;
  readonly photoRef: string;
  readonly location: ReportReviewLocation;
}

export interface HazardVerificationRepository {
  listPendingReports(): Promise<readonly PendingReport[]>;
  findReportForReview(reportId: string): Promise<ReportForReview | null>;
}

export class ReportNotFoundError extends Error {
  public readonly code = "NOT_FOUND";

  public constructor(reportId: string) {
    super(`Hazard report ${reportId} was not found.`);
    this.name = "ReportNotFoundError";
  }
}

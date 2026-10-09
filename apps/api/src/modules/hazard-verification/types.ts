import type {
  HazardType,
  LocationSource,
  ReportStatus,
  VerificationResult,
} from "@disaster/domain";

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
  decidePendingReport(command: DecisionCommand): Promise<DecisionPersistenceResult>;
}

export interface ReporterNotificationPort {
  requestDecisionNotification(input: {
    readonly reportId: string;
    readonly decision: "REJECTED";
    readonly rejectionReason: string;
  }): Promise<void>;
}

export interface DecisionCommand {
  readonly reportId: string;
  readonly officerId: string;
  readonly result: VerificationResult;
  readonly reason?: string;
  readonly decidedAt: Date;
}

export interface VerificationDecisionRecord {
  readonly id: string;
  readonly reportId: string;
  readonly officerId: string;
  readonly result: VerificationResult;
  readonly reason: string | null;
  readonly decidedAt: Date;
}

export type DecisionPersistenceResult =
  | { readonly kind: "DECIDED"; readonly decision: VerificationDecisionRecord }
  | { readonly kind: "REPORT_NOT_FOUND" }
  | { readonly kind: "REPORT_ALREADY_PROCESSED"; readonly status: ReportStatus };

export class ReportNotFoundError extends Error {
  public readonly code = "NOT_FOUND";

  public constructor(reportId: string) {
    super(`Hazard report ${reportId} was not found.`);
    this.name = "ReportNotFoundError";
  }
}

export class ValidationError extends Error {
  public readonly code = "VALIDATION_ERROR";

  public constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

export class ReportAlreadyProcessedError extends Error {
  public readonly code = "REPORT_ALREADY_PROCESSED";

  public constructor(public readonly status: ReportStatus) {
    super(`Hazard report has already been processed as ${status}.`);
    this.name = "ReportAlreadyProcessedError";
  }
}

import type { AlertSeverity, AlertStatus, HazardType, ReportStatus } from "@disaster/domain";

export interface SourceReport {
  readonly id: string;
  readonly status: ReportStatus;
  readonly hazardType: HazardType;
}

export interface AlertRecord {
  readonly id: string;
  readonly sourceReportId: string;
  readonly createdByOfficerId: string;
  readonly hazardType: HazardType;
  readonly severity: AlertSeverity;
  readonly message: string;
  readonly safetyInstructions: string;
  readonly status: AlertStatus;
  readonly version: number;
  readonly parentAlertId: string | null;
  readonly targetZoneIds: readonly string[];
  readonly issuedAt: Date | null;
  readonly cancelledAt: Date | null;
  readonly cancellationReason: string | null;
}

export interface CreateAlertFromReportInput {
  readonly reportId: string;
  readonly officerId: string;
}

export interface CreateAlertResult {
  readonly isNew: boolean;
  readonly alert: AlertRecord;
}

export interface CreateInitialAlertCommand {
  readonly sourceReportId: string;
  readonly createdByOfficerId: string;
  readonly hazardType: HazardType;
  readonly severity: AlertSeverity;
  readonly message: string;
  readonly safetyInstructions: string;
  readonly status: AlertStatus;
  readonly version: number;
  readonly parentAlertId: null;
}

export type CreateAlertPersistenceResult =
  | { readonly kind: "CREATED"; readonly alert: AlertRecord }
  | { readonly kind: "EXISTING"; readonly alert: AlertRecord };

export interface HazardBroadcastRepository {
  findSourceReport(reportId: string): Promise<SourceReport | null>;
  findInitialAlertForReport(reportId: string): Promise<AlertRecord | null>;
  createInitialAlert(command: CreateInitialAlertCommand): Promise<CreateAlertPersistenceResult>;
}

export class ReportNotFoundError extends Error {
  public readonly code = "NOT_FOUND";

  public constructor(reportId: string) {
    super(`Hazard report ${reportId} was not found.`);
    this.name = "ReportNotFoundError";
  }
}

export class ReportNotVerifiedError extends Error {
  public readonly code = "REPORT_NOT_VERIFIED";

  public constructor(public readonly status: ReportStatus) {
    super(`Cannot create alert draft from report with status ${status}. Report must be VERIFIED.`);
    this.name = "ReportNotVerifiedError";
  }
}

export class ValidationError extends Error {
  public readonly code = "VALIDATION_ERROR";

  public constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

import type {
  AlertSeverity,
  AlertStatus,
  DeliveryStatus,
  HazardType,
  ReportStatus,
  ZoneSeverity,
} from "@disaster/domain";

export interface SourceReport {
  readonly id: string;
  readonly status: ReportStatus;
  readonly hazardType: HazardType;
}

export interface TargetZoneSummary {
  readonly id: string;
  readonly name: string;
  readonly districtId: string;
  readonly severity: ZoneSeverity;
  readonly geometryRef: string;
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

export interface NotificationDeliveryRecord {
  readonly id: string;
  readonly alertId: string;
  readonly recipientRef: string;
  readonly status: DeliveryStatus;
  readonly attemptNo: number;
  readonly lastFailureReason: string | null;
  readonly updatedAt: Date;
}

export interface BroadcastAlertResult {
  readonly alert: AlertRecord;
  readonly deliveries: readonly NotificationDeliveryRecord[];
}

export interface AlertPreviewData {
  readonly alert: AlertRecord;
  readonly targetZones: readonly TargetZoneSummary[];
}

export interface AlertPreview {
  readonly alert: AlertRecord;
  readonly targetZones: readonly TargetZoneSummary[];
  readonly estimatedRecipients: number;
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

export interface UpdateDraftAlertInput {
  readonly alertId: string;
  readonly severity: AlertSeverity;
  readonly message: string;
  readonly safetyInstructions: string;
  readonly targetZoneIds: readonly string[];
}

export interface UpdateDraftAlertCommand {
  readonly alertId: string;
  readonly severity: AlertSeverity;
  readonly message: string;
  readonly safetyInstructions: string;
  readonly targetZoneIds: readonly string[];
}

export interface BroadcastAlertInput {
  readonly alertId: string;
  readonly officerId: string;
  readonly reason?: string | undefined;
}

export interface ActivateAlertCommand {
  readonly alertId: string;
  readonly officerId: string;
  readonly reason?: string | undefined;
  readonly recipientRefs?: readonly string[] | undefined;
  readonly issuedAt: Date;
}

export type CreateAlertPersistenceResult =
  | { readonly kind: "CREATED"; readonly alert: AlertRecord }
  | { readonly kind: "EXISTING"; readonly alert: AlertRecord };

export interface FindSimilarActiveAlertsQuery {
  readonly hazardType: HazardType;
  readonly targetZoneIds: readonly string[];
  readonly excludeAlertId?: string;
}

export interface CreateReplacementDraftInput {
  readonly parentAlertId: string;
  readonly officerId: string;
}

export interface CreateReplacementDraftCommand {
  readonly parentAlertId: string;
  readonly sourceReportId: string;
  readonly createdByOfficerId: string;
  readonly hazardType: HazardType;
  readonly severity: AlertSeverity;
  readonly message: string;
  readonly safetyInstructions: string;
  readonly status: AlertStatus;
  readonly version: number;
  readonly targetZoneIds: readonly string[];
}

export interface HazardBroadcastRepository {
  findSourceReport(reportId: string): Promise<SourceReport | null>;
  findAlertById(alertId: string): Promise<AlertRecord | null>;
  findInitialAlertForReport(reportId: string): Promise<AlertRecord | null>;
  findAlertPreview(alertId: string): Promise<AlertPreviewData | null>;
  findSimilarActiveAlerts(query: FindSimilarActiveAlertsQuery): Promise<AlertRecord[]>;
  createInitialAlert(command: CreateInitialAlertCommand): Promise<CreateAlertPersistenceResult>;
  updateDraftAlert(command: UpdateDraftAlertCommand): Promise<AlertRecord>;
  activateAlert(command: ActivateAlertCommand): Promise<BroadcastAlertResult>;
  createReplacementDraft(command: CreateReplacementDraftCommand): Promise<AlertRecord>;
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

export class AlertNotFoundError extends Error {
  public readonly code = "NOT_FOUND";

  public constructor(alertId: string) {
    super(`Alert ${alertId} was not found.`);
    this.name = "AlertNotFoundError";
  }
}

export class AlertNotInDraftError extends Error {
  public readonly code = "ALERT_NOT_IN_DRAFT";

  public constructor(public readonly status: AlertStatus) {
    super(`Cannot edit or broadcast alert with status ${status}. Alert must be in DRAFT.`);
    this.name = "AlertNotInDraftError";
  }
}

export class AlertAlreadyActiveError extends Error {
  public readonly code = "ALERT_ALREADY_ACTIVE";

  public constructor(public readonly status: AlertStatus = "ACTIVE" as AlertStatus) {
    super("The alert is already ACTIVE and cannot be broadcast again.");
    this.name = "AlertAlreadyActiveError";
  }
}

export class AlertNotActiveError extends Error {
  public readonly code = "ALERT_NOT_ACTIVE";

  public constructor(public readonly status: AlertStatus) {
    super(`Cannot create replacement draft from alert with status ${status}. Parent alert must be ACTIVE.`);
    this.name = "AlertNotActiveError";
  }
}

export class SimilarAlertActiveError extends Error {
  public readonly code = "SIMILAR_ALERT_ACTIVE";

  public constructor(public readonly similarAlertIds: readonly string[]) {
    super("A similar active alert already exists for this hazard type and target zone.");
    this.name = "SimilarAlertActiveError";
  }
}

export class ValidationError extends Error {
  public readonly code = "VALIDATION_ERROR";

  public constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

import { AlertSeverity, AlertStatus, ReportStatus } from "@disaster/domain";
import type {
  AlertPreview,
  AlertRecord,
  BroadcastAlertInput,
  BroadcastAlertResult,
  CreateAlertFromReportInput,
  CreateAlertResult,
  CreateReplacementDraftInput,
  HazardBroadcastRepository,
  TargetZoneSummary,
  UpdateDraftAlertInput,
} from "./types.js";
import {
  AlertAlreadyActiveError,
  AlertNotActiveError,
  AlertNotFoundError,
  AlertNotInDraftError,
  ReportNotFoundError,
  ReportNotVerifiedError,
  SimilarAlertActiveError,
  ValidationError,
} from "./types.js";

export type RecipientEstimator = (targetZones: readonly TargetZoneSummary[]) => number;
export type RecipientResolver = (targetZoneIds: readonly string[]) => Promise<readonly string[]> | readonly string[];

export const defaultRecipientEstimator: RecipientEstimator = () => 0;

export class HazardBroadcastService {
  public constructor(
    private readonly repository: HazardBroadcastRepository,
    private readonly estimateRecipients: RecipientEstimator = defaultRecipientEstimator,
    private readonly now: () => Date = () => new Date(),
    private readonly resolveRecipients?: RecipientResolver,
  ) {}

  public async createAlertFromVerifiedReport(
    input: CreateAlertFromReportInput,
  ): Promise<CreateAlertResult> {
    const report = await this.repository.findSourceReport(input.reportId);
    if (!report) {
      throw new ReportNotFoundError(input.reportId);
    }

    if (report.status !== ReportStatus.VERIFIED) {
      throw new ReportNotVerifiedError(report.status);
    }

    const result = await this.repository.createInitialAlert({
      sourceReportId: report.id,
      createdByOfficerId: input.officerId,
      hazardType: report.hazardType,
      severity: AlertSeverity.ADVISORY,
      message: "",
      safetyInstructions: "",
      status: AlertStatus.DRAFT,
      version: 1,
      parentAlertId: null,
    });

    return {
      isNew: result.kind === "CREATED",
      alert: result.alert,
    };
  }

  public async updateDraftAlert(input: UpdateDraftAlertInput): Promise<AlertRecord> {
    const existing = await this.repository.findAlertById(input.alertId);
    if (!existing) {
      throw new AlertNotFoundError(input.alertId);
    }

    if (existing.status !== AlertStatus.DRAFT) {
      throw new AlertNotInDraftError(existing.status);
    }

    const trimmedMessage = input.message.trim();
    if (!trimmedMessage) {
      throw new ValidationError("Alert message cannot be blank.");
    }
    if (trimmedMessage.length > 1000) {
      throw new ValidationError("Alert message cannot exceed 1000 characters.");
    }

    const trimmedInstructions = input.safetyInstructions.trim();
    if (!trimmedInstructions) {
      throw new ValidationError("Safety instructions cannot be blank.");
    }
    if (trimmedInstructions.length > 1000) {
      throw new ValidationError("Safety instructions cannot exceed 1000 characters.");
    }

    if (!input.targetZoneIds || input.targetZoneIds.length === 0) {
      throw new ValidationError("At least one target zone must be selected.");
    }

    return this.repository.updateDraftAlert({
      alertId: input.alertId,
      severity: input.severity,
      message: trimmedMessage,
      safetyInstructions: trimmedInstructions,
      targetZoneIds: input.targetZoneIds,
    });
  }

  public async getAlertPreview(alertId: string): Promise<AlertPreview> {
    const previewData = await this.repository.findAlertPreview(alertId);
    if (!previewData) {
      throw new AlertNotFoundError(alertId);
    }

    const estimatedRecipients = this.estimateRecipients(previewData.targetZones);

    return {
      alert: previewData.alert,
      targetZones: previewData.targetZones,
      estimatedRecipients,
    };
  }

  public async findSimilarActiveAlerts(alertId: string): Promise<AlertRecord[]> {
    const alert = await this.repository.findAlertById(alertId);
    if (!alert) {
      throw new AlertNotFoundError(alertId);
    }

    if (alert.targetZoneIds.length === 0) {
      return [];
    }

    return this.repository.findSimilarActiveAlerts({
      hazardType: alert.hazardType,
      targetZoneIds: alert.targetZoneIds,
      excludeAlertId: alert.id,
    });
  }

  public async broadcastAlert(input: BroadcastAlertInput): Promise<BroadcastAlertResult> {
    const alert = await this.repository.findAlertById(input.alertId);
    if (!alert) {
      throw new AlertNotFoundError(input.alertId);
    }

    if (alert.status === AlertStatus.ACTIVE) {
      throw new AlertAlreadyActiveError(alert.status);
    }

    if (alert.status !== AlertStatus.DRAFT) {
      throw new AlertNotInDraftError(alert.status);
    }

    const trimmedMessage = alert.message.trim();
    if (!trimmedMessage) {
      throw new ValidationError("Alert message cannot be blank.");
    }
    if (trimmedMessage.length > 1000) {
      throw new ValidationError("Alert message cannot exceed 1000 characters.");
    }

    const trimmedInstructions = alert.safetyInstructions.trim();
    if (!trimmedInstructions) {
      throw new ValidationError("Safety instructions cannot be blank.");
    }
    if (trimmedInstructions.length > 1000) {
      throw new ValidationError("Safety instructions cannot exceed 1000 characters.");
    }

    if (!alert.targetZoneIds || alert.targetZoneIds.length === 0) {
      throw new ValidationError("At least one target zone must be selected before broadcast.");
    }

    const similarAlerts = await this.repository.findSimilarActiveAlerts({
      hazardType: alert.hazardType,
      targetZoneIds: alert.targetZoneIds,
      excludeAlertId: alert.id,
    });

    if (similarAlerts.length > 0) {
      throw new SimilarAlertActiveError(similarAlerts.map((a) => a.id));
    }

    const recipientRefs = this.resolveRecipients
      ? await this.resolveRecipients(alert.targetZoneIds)
      : [];

    return this.repository.activateAlert({
      alertId: input.alertId,
      officerId: input.officerId,
      ...(input.reason !== undefined ? { reason: input.reason } : {}),
      recipientRefs,
      issuedAt: this.now(),
    });
  }

  public async createReplacementDraft(
    input: CreateReplacementDraftInput,
  ): Promise<AlertRecord> {
    const parent = await this.repository.findAlertById(input.parentAlertId);
    if (!parent) {
      throw new AlertNotFoundError(input.parentAlertId);
    }

    if (parent.status !== AlertStatus.ACTIVE) {
      throw new AlertNotActiveError(parent.status);
    }

    return this.repository.createReplacementDraft({
      parentAlertId: parent.id,
      sourceReportId: parent.sourceReportId,
      createdByOfficerId: input.officerId,
      hazardType: parent.hazardType,
      severity: parent.severity,
      message: parent.message,
      safetyInstructions: parent.safetyInstructions,
      status: AlertStatus.DRAFT,
      version: parent.version + 1,
      targetZoneIds: parent.targetZoneIds,
    });
  }
}

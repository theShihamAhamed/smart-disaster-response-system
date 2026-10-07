import { AlertSeverity, AlertStatus, DeliveryStatus, ReportStatus } from "@disaster/domain";
import type {
  AlertPreview,
  AlertRecord,
  BroadcastAlertInput,
  BroadcastAlertResult,
  CancelAlertInput,
  CreateAlertFromReportInput,
  CreateAlertResult,
  CreateReplacementDraftInput,
  DeliveryTrackingSummary,
  GatewayResult,
  HazardBroadcastRepository,
  NotificationDeliveryRecord,
  NotificationPayload,
  PushGateway,
  RetryPolicyOptions,
  RetryResult,
  SmsGateway,
  TargetZoneSummary,
  UpdateDraftAlertInput,
} from "./types.js";
import {
  AlertAlreadyActiveError,
  AlertNotActiveError,
  AlertNotFoundError,
  AlertNotInDraftError,
  DeliveryNotFoundError,
  ReportNotFoundError,
  ReportNotVerifiedError,
  SimilarAlertActiveError,
  ValidationError,
} from "./types.js";

export type RecipientEstimator = (targetZones: readonly TargetZoneSummary[]) => number;
export type RecipientResolver = (
  targetZoneIds: readonly string[],
) => Promise<readonly string[]> | readonly string[];

export const defaultRecipientEstimator: RecipientEstimator = () => 0;

export const defaultPushGateway: PushGateway = {
  sendPush: async () => ({ success: true }),
};

export const defaultSmsGateway: SmsGateway = {
  sendSms: async () => ({ success: true }),
};

export class HazardBroadcastService {
  private readonly inFlightDeliveries = new Set<string>();

  public constructor(
    private readonly repository: HazardBroadcastRepository,
    private readonly estimateRecipients: RecipientEstimator = defaultRecipientEstimator,
    private readonly now: () => Date = () => new Date(),
    private readonly resolveRecipients?: RecipientResolver,
    private readonly pushGateway?: PushGateway,
    private readonly smsGateway?: SmsGateway,
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

    if (alert.parentAlertId) {
      const parent = await this.repository.findAlertById(alert.parentAlertId);
      if (!parent) {
        throw new AlertNotFoundError(alert.parentAlertId);
      }
      if (parent.status !== AlertStatus.ACTIVE) {
        throw new AlertNotActiveError(
          parent.status,
          `Cannot broadcast replacement draft because parent alert is ${parent.status}. Parent must be ACTIVE.`,
        );
      }
    }

    const excludeIds = alert.parentAlertId ? [alert.id, alert.parentAlertId] : [alert.id];
    const similarAlerts = await this.repository.findSimilarActiveAlerts({
      hazardType: alert.hazardType,
      targetZoneIds: alert.targetZoneIds,
      excludeAlertId: alert.id,
      excludeAlertIds: excludeIds,
    });

    if (similarAlerts.length > 0) {
      throw new SimilarAlertActiveError(similarAlerts.map((a) => a.id));
    }

    const recipientRefs = this.resolveRecipients
      ? await this.resolveRecipients(alert.targetZoneIds)
      : [];

    const activateResult = await this.repository.activateAlert({
      alertId: input.alertId,
      officerId: input.officerId,
      ...(input.reason !== undefined ? { reason: input.reason } : {}),
      recipientRefs,
      issuedAt: this.now(),
    });

    let processedDeliveries: NotificationDeliveryRecord[] = [];
    if (activateResult.deliveries.length > 0 && (this.pushGateway || this.smsGateway)) {
      for (const delivery of activateResult.deliveries) {
        const processed = await this.processDelivery(activateResult.alert, delivery);
        processedDeliveries.push(processed);
      }
    } else {
      processedDeliveries = [...activateResult.deliveries];
    }

    return {
      alert: activateResult.alert,
      deliveries: processedDeliveries,
    };
  }

  public async processDelivery(
    alert: AlertRecord,
    delivery: NotificationDeliveryRecord,
  ): Promise<NotificationDeliveryRecord> {
    const payload: NotificationPayload = {
      alertId: alert.id,
      hazardType: alert.hazardType,
      severity: alert.severity,
      message: alert.message,
      safetyInstructions: alert.safetyInstructions,
    };

    const pushGateway = this.pushGateway ?? defaultPushGateway;
    const smsGateway = this.smsGateway ?? defaultSmsGateway;

    // Push Attempt 1
    let push1Result: GatewayResult;
    try {
      push1Result = await pushGateway.sendPush(delivery.recipientRef, payload);
    } catch (error) {
      push1Result = {
        success: false,
        error: error instanceof Error ? error.message : "Push gateway error",
      };
    }

    if (push1Result.success) {
      return this.repository.updateDelivery({
        deliveryId: delivery.id,
        status: DeliveryStatus.PUSH_SENT,
        attemptNo: 1,
        lastFailureReason: null,
        updatedAt: this.now(),
      });
    }

    // Push Attempt 2 (Retry)
    let push2Result: GatewayResult;
    try {
      push2Result = await pushGateway.sendPush(delivery.recipientRef, payload);
    } catch (error) {
      push2Result = {
        success: false,
        error: error instanceof Error ? error.message : "Push gateway retry error",
      };
    }

    if (push2Result.success) {
      return this.repository.updateDelivery({
        deliveryId: delivery.id,
        status: DeliveryStatus.PUSH_SENT,
        attemptNo: 2,
        lastFailureReason: null,
        updatedAt: this.now(),
      });
    }

    // SMS Fallback (only reached if both push attempts failed)
    let smsResult: GatewayResult;
    try {
      smsResult = await smsGateway.sendSms(delivery.recipientRef, payload);
    } catch (error) {
      smsResult = {
        success: false,
        error: error instanceof Error ? error.message : "SMS gateway error",
      };
    }

    if (smsResult.success) {
      return this.repository.updateDelivery({
        deliveryId: delivery.id,
        status: DeliveryStatus.SMS_SENT,
        attemptNo: 3,
        lastFailureReason: push2Result.error ?? "Push attempts failed; sent via SMS fallback",
        updatedAt: this.now(),
      });
    }

    // Final Failure (both push attempts and SMS fallback failed)
    return this.repository.updateDelivery({
      deliveryId: delivery.id,
      status: DeliveryStatus.FAILED_FINAL,
      attemptNo: 3,
      lastFailureReason: smsResult.error ?? "All push attempts and SMS fallback failed",
      updatedAt: this.now(),
    });
  }

  public async processDeliveries(alertId: string): Promise<NotificationDeliveryRecord[]> {
    const alert = await this.repository.findAlertById(alertId);
    if (!alert) {
      throw new AlertNotFoundError(alertId);
    }

    const deliveries = await this.repository.findDeliveriesByAlertId(alertId);
    const pendingDeliveries = deliveries.filter((d) => d.status === DeliveryStatus.PENDING);

    const results: NotificationDeliveryRecord[] = [];
    for (const delivery of pendingDeliveries) {
      const updated = await this.processDelivery(alert, delivery);
      results.push(updated);
    }

    return results;
  }

  public async getDeliveryTracking(alertId: string): Promise<DeliveryTrackingSummary> {
    const alert = await this.repository.findAlertById(alertId);
    if (!alert) {
      throw new AlertNotFoundError(alertId);
    }

    const deliveries = await this.repository.findDeliveriesByAlertId(alertId);
    let pending = 0;
    let pushSent = 0;
    let pushFailed = 0;
    let smsFallbackQueued = 0;
    let smsSent = 0;
    let failedFinal = 0;

    for (const d of deliveries) {
      switch (d.status) {
        case DeliveryStatus.PENDING:
          pending++;
          break;
        case DeliveryStatus.PUSH_SENT:
          pushSent++;
          break;
        case DeliveryStatus.PUSH_FAILED:
          pushFailed++;
          break;
        case DeliveryStatus.SMS_FALLBACK_QUEUED:
          smsFallbackQueued++;
          break;
        case DeliveryStatus.SMS_SENT:
          smsSent++;
          break;
        case DeliveryStatus.FAILED_FINAL:
          failedFinal++;
          break;
      }
    }

    return {
      alertId,
      total: deliveries.length,
      pending,
      pushSent,
      pushFailed,
      smsFallbackQueued,
      smsSent,
      failedFinal,
      deliveries,
    };
  }

  public async retryDelivery(
    deliveryId: string,
    options?: RetryPolicyOptions,
  ): Promise<RetryResult> {
    if (this.inFlightDeliveries.has(deliveryId)) {
      const existing = await this.repository.findDeliveryById(deliveryId);
      if (!existing) {
        throw new DeliveryNotFoundError(deliveryId);
      }
      return {
        attempted: false,
        skippedReason: "CONCURRENT_PROCESSING_BLOCKED",
        delivery: existing,
      };
    }

    this.inFlightDeliveries.add(deliveryId);
    try {
      const delivery = await this.repository.findDeliveryById(deliveryId);
      if (!delivery) {
        throw new DeliveryNotFoundError(deliveryId);
      }

      const alert = await this.repository.findAlertById(delivery.alertId);
      if (!alert) {
        throw new AlertNotFoundError(delivery.alertId);
      }

      if (
        delivery.status === DeliveryStatus.PUSH_SENT ||
        delivery.status === DeliveryStatus.SMS_SENT
      ) {
        return {
          attempted: false,
          skippedReason: "ALREADY_SUCCEEDED",
          delivery,
        };
      }

      if (delivery.status === DeliveryStatus.FAILED_FINAL) {
        return {
          attempted: false,
          skippedReason: "FINAL_FAILURE_REACHED",
          delivery,
        };
      }

      const maxAttempts = options?.maxAttempts ?? 3;
      if (delivery.attemptNo >= maxAttempts) {
        const finalFailed = await this.repository.updateDelivery({
          deliveryId: delivery.id,
          status: DeliveryStatus.FAILED_FINAL,
          attemptNo: maxAttempts,
          lastFailureReason: delivery.lastFailureReason ?? "Max retry attempts reached",
          updatedAt: this.now(),
        });
        return {
          attempted: false,
          skippedReason: "MAX_RETRIES_EXCEEDED",
          delivery: finalFailed,
        };
      }

      if (
        options?.minRetryIntervalMs &&
        options.minRetryIntervalMs > 0 &&
        delivery.attemptNo > 0
      ) {
        const elapsedMs = this.now().getTime() - delivery.updatedAt.getTime();
        if (elapsedMs < options.minRetryIntervalMs) {
          return {
            attempted: false,
            skippedReason: "RETRY_NOT_DUE_YET",
            delivery,
          };
        }
      }

      const isCancelled = alert.status === AlertStatus.CANCELLED;
      const payload: NotificationPayload = {
        alertId: alert.id,
        hazardType: alert.hazardType,
        severity: alert.severity,
        message: isCancelled
          ? `[ALL CLEAR] ${alert.cancellationReason ?? alert.message}`
          : alert.message,
        safetyInstructions: isCancelled
          ? "The hazard situation has ended. All clear."
          : alert.safetyInstructions,
      };

      const pushGateway = this.pushGateway ?? defaultPushGateway;
      const smsGateway = this.smsGateway ?? defaultSmsGateway;

      if (delivery.status === DeliveryStatus.PENDING) {
        let pushResult: GatewayResult;
        try {
          pushResult = await pushGateway.sendPush(delivery.recipientRef, payload);
        } catch (error) {
          pushResult = {
            success: false,
            error: error instanceof Error ? error.message : "Push gateway error",
          };
        }

        const updated = await this.repository.updateDelivery({
          deliveryId: delivery.id,
          status: pushResult.success ? DeliveryStatus.PUSH_SENT : DeliveryStatus.PUSH_FAILED,
          attemptNo: 1,
          lastFailureReason: pushResult.success ? null : (pushResult.error ?? "Push attempt failed"),
          updatedAt: this.now(),
        });
        return { attempted: true, delivery: updated };
      }

      if (delivery.status === DeliveryStatus.PUSH_FAILED) {
        let pushRetryResult: GatewayResult;
        try {
          pushRetryResult = await pushGateway.sendPush(delivery.recipientRef, payload);
        } catch (error) {
          pushRetryResult = {
            success: false,
            error: error instanceof Error ? error.message : "Push gateway retry error",
          };
        }

        const updated = await this.repository.updateDelivery({
          deliveryId: delivery.id,
          status: pushRetryResult.success
            ? DeliveryStatus.PUSH_SENT
            : DeliveryStatus.SMS_FALLBACK_QUEUED,
          attemptNo: 2,
          lastFailureReason: pushRetryResult.success
            ? null
            : (pushRetryResult.error ?? "Push retry failed; queued for SMS fallback"),
          updatedAt: this.now(),
        });
        return { attempted: true, delivery: updated };
      }

      if (delivery.status === DeliveryStatus.SMS_FALLBACK_QUEUED) {
        let smsResult: GatewayResult;
        try {
          smsResult = await smsGateway.sendSms(delivery.recipientRef, payload);
        } catch (error) {
          smsResult = {
            success: false,
            error: error instanceof Error ? error.message : "SMS gateway error",
          };
        }

        const updated = await this.repository.updateDelivery({
          deliveryId: delivery.id,
          status: smsResult.success ? DeliveryStatus.SMS_SENT : DeliveryStatus.FAILED_FINAL,
          attemptNo: 3,
          lastFailureReason: smsResult.success
            ? (delivery.lastFailureReason ?? "Sent via SMS fallback")
            : (smsResult.error ?? "All push attempts and SMS fallback failed"),
          updatedAt: this.now(),
        });
        return { attempted: true, delivery: updated };
      }

      return { attempted: false, skippedReason: "INELIGIBLE_STATUS", delivery };
    } finally {
      this.inFlightDeliveries.delete(deliveryId);
    }
  }

  public async retryEligibleDeliveries(
    alertId: string,
    options?: RetryPolicyOptions,
  ): Promise<RetryResult[]> {
    const alert = await this.repository.findAlertById(alertId);
    if (!alert) {
      throw new AlertNotFoundError(alertId);
    }

    const deliveries = await this.repository.findDeliveriesByAlertId(alertId);
    const results: RetryResult[] = [];

    for (const delivery of deliveries) {
      const isTerminal =
        delivery.status === DeliveryStatus.PUSH_SENT ||
        delivery.status === DeliveryStatus.SMS_SENT ||
        delivery.status === DeliveryStatus.FAILED_FINAL;

      if (isTerminal) {
        results.push({
          attempted: false,
          skippedReason:
            delivery.status === DeliveryStatus.FAILED_FINAL
              ? "FINAL_FAILURE_REACHED"
              : "ALREADY_SUCCEEDED",
          delivery,
        });
        continue;
      }

      const res = await this.retryDelivery(delivery.id, options);
      results.push(res);
    }

    return results;
  }

  public async createReplacementDraft(input: CreateReplacementDraftInput): Promise<AlertRecord> {
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

  public async cancelAlert(input: CancelAlertInput): Promise<AlertRecord> {
    const alert = await this.repository.findAlertById(input.alertId);
    if (!alert) {
      throw new AlertNotFoundError(input.alertId);
    }

    if (alert.status !== AlertStatus.ACTIVE) {
      throw new AlertNotActiveError(alert.status);
    }

    const trimmedReason = typeof input.reason === "string" ? input.reason.trim() : "";
    if (trimmedReason.length < 10) {
      throw new ValidationError("Cancellation reason must be at least 10 characters.");
    }
    if (trimmedReason.length > 500) {
      throw new ValidationError("Cancellation reason cannot exceed 500 characters.");
    }

    const recipientRefs = this.resolveRecipients
      ? await this.resolveRecipients(alert.targetZoneIds)
      : [];

    return this.repository.cancelAlert({
      alertId: input.alertId,
      officerId: input.officerId,
      reason: trimmedReason,
      cancelledAt: this.now(),
      recipientRefs,
    });
  }
}

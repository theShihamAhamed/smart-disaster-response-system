import type {
  AlertSeverity,
  AlertStatus,
  DeliveryStatus,
  HazardType,
} from "@disaster/domain";

export interface TargetZoneOption {
  readonly id: string;
  readonly code?: string;
  readonly name: string;
  readonly districtId?: string;
  readonly districtName?: string;
  readonly severity?: string;
  readonly populationEstimate?: number;
}

export interface DeliveryItem {
  readonly id: string;
  readonly alertId: string;
  readonly recipientRef: string;
  readonly channel?: "PUSH" | "SMS";
  readonly status: DeliveryStatus;
  readonly attemptNo: number;
  readonly lastFailureReason: string | null;
  readonly updatedAt: string;
}

export interface DeliverySummary {
  readonly total: number;
  readonly pending: number;
  readonly pushSent: number;
  readonly pushFailed: number;
  readonly smsFallbackQueued: number;
  readonly smsSent: number;
  readonly failedFinal: number;
}

export interface DeliveryTrackingResponse {
  readonly alertId: string;
  readonly total: number;
  readonly pending: number;
  readonly pushSent: number;
  readonly pushFailed: number;
  readonly smsFallbackQueued: number;
  readonly smsSent: number;
  readonly failedFinal: number;
  readonly deliveries: readonly DeliveryItem[];
}

export interface BroadcastResult {
  readonly alert: AlertSummaryItem;
  readonly deliveries: readonly DeliveryItem[];
}

export interface AlertSummaryItem {
  readonly id: string;
  readonly sourceReportId: string;
  readonly createdByOfficerId?: string;
  readonly hazardType: HazardType;
  readonly severity: AlertSeverity;
  readonly message: string;
  readonly safetyInstructions: string;
  readonly status: AlertStatus;
  readonly version: number;
  readonly parentAlertId: string | null;
  readonly targetZoneIds: readonly string[];
  readonly issuedAt: string | null;
  readonly cancelledAt: string | null;
  readonly cancellationReason: string | null;
}

export interface AlertPreviewInfo {
  readonly alert: AlertSummaryItem;
  readonly targetZones: readonly TargetZoneOption[];
  readonly estimatedRecipients: number;
}

export interface BroadcastApi {
  createFromReport(reportId: string): Promise<AlertSummaryItem>;
  updateDraft(
    alertId: string,
    body: {
      severity: AlertSeverity;
      message: string;
      safetyInstructions: string;
      targetZoneIds: readonly string[];
    },
  ): Promise<AlertSummaryItem>;
  getPreview(alertId: string): Promise<AlertPreviewInfo>;
  getSimilarActive(alertId: string): Promise<readonly AlertSummaryItem[]>;
  broadcastAlert(alertId: string, idempotencyKey?: string): Promise<BroadcastResult>;
  getDeliveries(alertId: string): Promise<DeliveryTrackingResponse>;
  retryDeliveries(alertId: string): Promise<{ alertId: string; results: readonly unknown[] }>;
  createReplacementDraft(parentAlertId: string): Promise<AlertSummaryItem>;
  cancelAlert(alertId: string, reason: string, idempotencyKey?: string): Promise<AlertSummaryItem>;
}

export function createBroadcastApi(client: {
  get<T>(path: string): Promise<T>;
  post<TResponse, TBody = unknown>(
    path: string,
    options?: { body?: TBody; headers?: HeadersInit },
  ): Promise<TResponse>;
  patch<TResponse, TBody = unknown>(
    path: string,
    options?: { body?: TBody; headers?: HeadersInit },
  ): Promise<TResponse>;
}): BroadcastApi {
  return {
    createFromReport: (reportId) => client.post(`/alerts/from-report/${reportId}`),
    updateDraft: (alertId, body) => client.patch(`/alerts/${alertId}`, { body }),
    getPreview: (alertId) => client.get(`/alerts/${alertId}/preview`),
    getSimilarActive: (alertId) => client.get(`/alerts/${alertId}/similar-active`),
    broadcastAlert: (alertId, idempotencyKey) =>
      client.post(
        `/alerts/${alertId}/broadcast`,
        idempotencyKey ? { headers: { "Idempotency-Key": idempotencyKey } } : {},
      ),
    getDeliveries: (alertId) => client.get(`/alerts/${alertId}/deliveries`),
    retryDeliveries: (alertId) => client.post(`/alerts/${alertId}/deliveries/retry`),
    createReplacementDraft: (parentAlertId) =>
      client.post(`/alerts/${parentAlertId}/replacement-drafts`),
    cancelAlert: (alertId, reason, idempotencyKey) =>
      client.post(
        `/alerts/${alertId}/cancel`,
        idempotencyKey
          ? { body: { reason }, headers: { "Idempotency-Key": idempotencyKey } }
          : { body: { reason } },
      ),
  };
}

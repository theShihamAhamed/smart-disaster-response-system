import type { LocationSource, ReportStatus } from "@disaster/domain";

export interface PendingReport {
  readonly id: string;
  readonly status: ReportStatus;
  readonly hazardType: string;
  readonly submittedAt: string;
  readonly requiresExtraReview: boolean;
}

export interface ReportReview extends PendingReport {
  readonly description: string;
  readonly photoRef: string;
  readonly location: {
    readonly latitude: number;
    readonly longitude: number;
    readonly districtId: string;
    readonly address: string | null;
    readonly source: LocationSource;
  };
}

export interface DraftAlert {
  readonly alertId: string;
  readonly sourceReportId: string;
  readonly status: "DRAFT";
  readonly version: number;
}

export interface EscalationResult {
  readonly httpStatus: 200 | 201;
  readonly draft: DraftAlert;
}

export interface VerificationApi {
  listPendingReports(): Promise<readonly PendingReport[]>;
  getReportForReview(reportId: string): Promise<ReportReview>;
  decideReport(
    reportId: string,
    body: { result: "VERIFIED" | "REJECTED"; reason?: string },
    idempotencyKey: string,
  ): Promise<unknown>;
  escalateVerifiedReport(reportId: string, idempotencyKey: string): Promise<EscalationResult>;
}

export function createVerificationApi(client: {
  get<T>(path: string): Promise<T>;
  post<TResponse, TBody>(
    path: string,
    options: { body?: TBody; headers: HeadersInit },
  ): Promise<TResponse>;
  postWithResponse<TResponse, TBody>(
    path: string,
    options: { body?: TBody; headers: HeadersInit },
  ): Promise<{ readonly status: number; readonly body: TResponse }>;
}): VerificationApi {
  return {
    listPendingReports: () =>
      client.get<readonly PendingReport[]>("/verification/reports?status=PENDING"),
    getReportForReview: (reportId) => client.get<ReportReview>(`/verification/reports/${reportId}`),
    decideReport: (reportId, body, idempotencyKey) =>
      client.post(`/verification/reports/${reportId}/decision`, {
        body,
        headers: { "Idempotency-Key": idempotencyKey },
      }),
    escalateVerifiedReport: async (reportId, idempotencyKey) => {
      if (!idempotencyKey.trim()) {
        throw new Error("An idempotency key is required for escalation.");
      }
      const response = await client.postWithResponse<DraftAlert, never>(
        `/verification/reports/${reportId}/escalations`,
        { headers: { "Idempotency-Key": idempotencyKey } },
      );
      if (response.status !== 200 && response.status !== 201) {
        throw new Error("Unexpected escalation response status.");
      }
      return { httpStatus: response.status, draft: response.body };
    },
  };
}

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

export interface VerificationApi {
  listPendingReports(): Promise<readonly PendingReport[]>;
  getReportForReview(reportId: string): Promise<ReportReview>;
}

export function createVerificationApi(client: {
  get<T>(path: string): Promise<T>;
}): VerificationApi {
  return {
    listPendingReports: () =>
      client.get<readonly PendingReport[]>("/verification/reports?status=PENDING"),
    getReportForReview: (reportId) => client.get<ReportReview>(`/verification/reports/${reportId}`),
  };
}

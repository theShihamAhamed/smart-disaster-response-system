import type { HazardType, ReportStatus, UserRole } from "@disaster/domain";

export type FieldErrors = Readonly<Record<string, readonly string[]>>;

export interface ApiErrorBody {
  readonly code: string;
  readonly message: string;
  readonly fieldErrors: FieldErrors;
  readonly details: Readonly<Record<string, unknown>>;
}

export interface ApiErrorEnvelope {
  readonly error: ApiErrorBody;
}

export interface AuthContext {
  readonly userId: string;
  readonly role: UserRole;
  readonly assignedAreaId?: string;
  readonly districtId?: string;
  readonly canBroadcast?: boolean;
}

export interface PageMeta {
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
}

export interface Paginated<T> {
  readonly data: readonly T[];
  readonly meta: PageMeta;
}

export interface HealthResponse {
  readonly status: "ok";
}

export interface SubmitHazardReportResponse {
  readonly reportId: string;
  readonly clientReportId: string;
  readonly status: ReportStatus;
  readonly hazardType: HazardType;
  readonly outsideAssignedArea: boolean;
  readonly requiresExtraReview: boolean;
  readonly submittedAt: string;
}

export interface HazardReportStatusResponse {
  readonly reportId: string;
  readonly status: ReportStatus;
  readonly reason?: string;
}

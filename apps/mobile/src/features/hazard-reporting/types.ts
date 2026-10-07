import type { HazardType, LocationSource, ReportStatus } from "@disaster/domain";
import type { SubmitHazardReportInput } from "@disaster/shared-validation";

export interface Coordinates {
  readonly latitude: number;
  readonly longitude: number;
}

export interface ReportLocation extends Coordinates {
  readonly source: LocationSource;
}

/** A report the user is still filling in. It only lives in memory until it is submitted. */
export interface ReportDraft {
  readonly localState: "DRAFT";
  /** Created once, before the first network attempt, and never changed. */
  readonly clientReportId: string;
  readonly hazardType: HazardType | null;
  readonly description: string;
  readonly photoUri: string | null;
  /** Only a GPS fix or a CONFIRMED manual pin ends up here. */
  readonly location: ReportLocation | null;
  /** A manual pin the user has placed but not confirmed yet. */
  readonly pendingPin: Coordinates | null;
}

export interface ReportFieldErrors {
  readonly hazardType?: string;
  readonly description?: string;
  readonly photo?: string;
  readonly location?: string;
}

/** What the server told us when it accepted the report. */
export interface Acknowledgement {
  readonly reportId: string;
  readonly status: ReportStatus;
  readonly outsideAssignedArea: boolean;
  readonly requiresExtraReview: boolean;
  readonly submittedAt: string;
  readonly rejectionReason: string | null;
}

/** PENDING_SYNC = saved on the phone, server has not confirmed. SYNCED = server confirmed. */
export type LocalReportState = "PENDING_SYNC" | "SYNCED";

/** One record in the offline queue. */
export interface StoredReport {
  readonly clientReportId: string;
  readonly state: LocalReportState;
  readonly payload: SubmitHazardReportInput;
  /** Local copy of the photo. Removed only after the acknowledgement has been saved. */
  readonly localPhotoUri: string | null;
  readonly createdAt: string;
  readonly attempts: number;
  readonly lastError: string | null;
  /** The server refused this report (for example 422), so retrying alone will not help. */
  readonly needsAttention: boolean;
  readonly acknowledgement: Acknowledgement | null;
}

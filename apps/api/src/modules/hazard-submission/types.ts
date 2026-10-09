import type { HazardType, LocationSource, ReportStatus } from "@disaster/domain";

/** A hazard report as the API sees it after it has been stored. */
export interface HazardReportRecord {
  readonly id: string;
  readonly clientReportId: string;
  readonly reporterId: string;
  readonly hazardType: HazardType;
  readonly status: ReportStatus;
  readonly outsideAssignedArea: boolean;
  readonly requiresExtraReview: boolean;
  readonly submittedAt: Date;
  /** Only set when an officer rejected the report (read-only for this component). */
  readonly rejectionReason: string | null;
}

export interface NewHazardReport {
  readonly id: string;
  readonly clientReportId: string;
  readonly reporterId: string;
  readonly hazardType: HazardType;
  readonly description: string;
  readonly photoRef: string;
  readonly submittedAt: Date;
  readonly outsideAssignedArea: boolean;
  readonly requiresExtraReview: boolean;
  readonly location: {
    readonly id: string;
    readonly latitude: number;
    readonly longitude: number;
    readonly districtId: string;
    readonly source: LocationSource;
  };
}

export interface CreateReportResult {
  readonly record: HazardReportRecord;
  /** false when an earlier report with the same clientReportId already existed. */
  readonly created: boolean;
}

/** Port: how the service reads and writes reports. Prisma implements it in production. */
export interface HazardSubmissionRepository {
  findById(id: string): Promise<HazardReportRecord | null>;
  findByClientReportId(clientReportId: string): Promise<HazardReportRecord | null>;
  create(report: NewHazardReport): Promise<CreateReportResult>;
}

/** Port: stand-in for a real map/geocoding service (the design calls for a mock adapter). */
export interface GeoAdapter {
  resolveDistrictId(latitude: number, longitude: number): string;
  isInsideArea(areaId: string, latitude: number, longitude: number): boolean;
}

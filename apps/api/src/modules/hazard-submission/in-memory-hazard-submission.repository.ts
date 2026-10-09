import type {
  CreateReportResult,
  HazardReportRecord,
  HazardSubmissionRepository,
  NewHazardReport,
} from "./types.js";

/** Test double that behaves like the database: unique clientReportId, PENDING on create. */
export class InMemoryHazardSubmissionRepository implements HazardSubmissionRepository {
  public readonly records: HazardReportRecord[] = [];

  public findById(id: string): Promise<HazardReportRecord | null> {
    return Promise.resolve(this.records.find((r) => r.id === id) ?? null);
  }

  public findByClientReportId(clientReportId: string): Promise<HazardReportRecord | null> {
    return Promise.resolve(this.records.find((r) => r.clientReportId === clientReportId) ?? null);
  }

  public create(report: NewHazardReport): Promise<CreateReportResult> {
    const existing = this.records.find((r) => r.clientReportId === report.clientReportId);
    if (existing) {
      return Promise.resolve({ record: existing, created: false });
    }
    const record: HazardReportRecord = {
      id: report.id,
      clientReportId: report.clientReportId,
      reporterId: report.reporterId,
      hazardType: report.hazardType,
      status: "PENDING",
      outsideAssignedArea: report.outsideAssignedArea,
      requiresExtraReview: report.requiresExtraReview,
      submittedAt: report.submittedAt,
      rejectionReason: null,
    };
    this.records.push(record);
    return Promise.resolve({ record, created: true });
  }
}

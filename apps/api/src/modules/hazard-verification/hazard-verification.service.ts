import type { HazardVerificationRepository, PendingReport, ReportForReview } from "./types.js";
import { ReportNotFoundError } from "./types.js";

export class HazardVerificationService {
  public constructor(private readonly repository: HazardVerificationRepository) {}

  public listPendingReports(): Promise<readonly PendingReport[]> {
    return this.repository.listPendingReports();
  }

  public async getReportForReview(reportId: string): Promise<ReportForReview> {
    const report = await this.repository.findReportForReview(reportId);
    if (!report) {
      throw new ReportNotFoundError(reportId);
    }
    return report;
  }
}

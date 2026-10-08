import type { HazardReportApi } from "../ports/hazard-report-api";
import type { OfflineReportRepository } from "../repositories/offline-report-repository.ts";
import type { StoredReport } from "../types";

/**
 * READ-ONLY status checking. It asks the server what an officer decided and saves the answer.
 * The phone never decides VERIFIED or REJECTED itself.
 */
export class ReportStatusService {
  public constructor(
    private readonly api: HazardReportApi,
    private readonly repository: OfflineReportRepository,
  ) {}

  public async refresh(clientReportId: string): Promise<StoredReport | null> {
    const report = await this.repository.get(clientReportId);
    if (report === null || report.state !== "SYNCED" || report.acknowledgement === null) {
      return report;
    }
    try {
      const latest = await this.api.getStatus(report.acknowledgement.reportId);
      return await this.repository.updateServerStatus(
        clientReportId,
        latest.status,
        latest.reason ?? null,
      );
    } catch {
      return report; // no answer right now: keep showing what we already know
    }
  }

  public async refreshAll(): Promise<readonly StoredReport[]> {
    const reports = await this.repository.list();
    for (const report of reports) {
      if (report.state === "SYNCED") {
        await this.refresh(report.clientReportId);
      }
    }
    return this.repository.list();
  }
}

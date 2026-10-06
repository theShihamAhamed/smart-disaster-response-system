import { AlertSeverity, AlertStatus, ReportStatus } from "@disaster/domain";
import type {
  CreateAlertFromReportInput,
  CreateAlertResult,
  HazardBroadcastRepository,
} from "./types.js";
import { ReportNotFoundError, ReportNotVerifiedError } from "./types.js";

export class HazardBroadcastService {
  public constructor(
    private readonly repository: HazardBroadcastRepository,
    private readonly now: () => Date = () => new Date(),
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
}

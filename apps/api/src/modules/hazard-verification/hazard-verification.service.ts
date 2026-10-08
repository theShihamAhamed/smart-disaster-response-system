import {
  VerificationResult,
  type VerificationResult as VerificationResultValue,
} from "@disaster/domain";
import type {
  HazardVerificationRepository,
  PendingReport,
  ReportForReview,
  VerificationDecisionRecord,
} from "./types.js";
import { ReportAlreadyProcessedError, ReportNotFoundError, ValidationError } from "./types.js";

export interface DecideReportInput {
  readonly reportId: string;
  readonly officerId: string;
  readonly result: VerificationResultValue;
  readonly reason?: string;
}

export class HazardVerificationService {
  public constructor(
    private readonly repository: HazardVerificationRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

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

  public async decideReport(input: DecideReportInput): Promise<VerificationDecisionRecord> {
    const { reason: suppliedReason, ...command } = input;
    const reason = this.validateAndNormalizeReason(input.result, suppliedReason);
    const result = await this.repository.decidePendingReport({
      ...command,
      ...(reason === undefined ? {} : { reason }),
      decidedAt: this.now(),
    });

    if (result.kind === "DECIDED") {
      return result.decision;
    }
    if (result.kind === "REPORT_NOT_FOUND") {
      throw new ReportNotFoundError(input.reportId);
    }
    throw new ReportAlreadyProcessedError(result.status);
  }

  private validateAndNormalizeReason(
    result: VerificationResultValue,
    suppliedReason: string | undefined,
  ): string | undefined {
    if (result !== VerificationResult.VERIFIED && result !== VerificationResult.REJECTED) {
      throw new ValidationError("Verification result must be VERIFIED or REJECTED.");
    }
    if (result === VerificationResult.VERIFIED) {
      return suppliedReason?.trim() || undefined;
    }

    const reason = suppliedReason?.trim();
    if (!reason || reason.length < 10 || reason.length > 500) {
      throw new ValidationError(
        "A rejection reason must contain 10 to 500 non-whitespace characters.",
      );
    }
    return reason;
  }
}

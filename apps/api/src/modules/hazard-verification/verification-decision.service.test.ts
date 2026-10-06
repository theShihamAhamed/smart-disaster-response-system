import { ReportStatus, VerificationResult } from "@disaster/domain";
import { describe, expect, it } from "vitest";
import { HazardVerificationService } from "./hazard-verification.service.js";
import type {
  DecisionCommand,
  DecisionPersistenceResult,
  HazardVerificationRepository,
  PendingReport,
  ReportForReview,
  VerificationDecisionRecord,
} from "./types.js";
import { ReportAlreadyProcessedError, ReportNotFoundError, ValidationError } from "./types.js";

const reportId = "40000000-0000-4000-8000-000000000001";
const officerOne = "10000000-0000-4000-8000-000000000003";
const officerTwo = "10000000-0000-4000-8000-000000000004";
const decidedAt = new Date("2026-10-05T10:00:00.000Z");

class InMemoryDecisionRepository implements HazardVerificationRepository {
  public readonly decisions: VerificationDecisionRecord[] = [];
  public failNextDecision = false;

  public constructor(private status: ReportStatus | undefined = ReportStatus.PENDING) {}

  public async listPendingReports(): Promise<readonly PendingReport[]> {
    return [];
  }

  public async findReportForReview(_reportId: string): Promise<ReportForReview | null> {
    void _reportId;
    return null;
  }

  public async decidePendingReport(command: DecisionCommand): Promise<DecisionPersistenceResult> {
    if (!this.status) {
      return { kind: "REPORT_NOT_FOUND" };
    }
    if (this.status !== ReportStatus.PENDING) {
      return { kind: "REPORT_ALREADY_PROCESSED", status: this.status };
    }
    if (this.failNextDecision) {
      this.failNextDecision = false;
      throw new Error("Database write failed.");
    }

    const decision: VerificationDecisionRecord = {
      id: `decision-${this.decisions.length + 1}`,
      ...command,
      reason: command.reason ?? null,
    };
    this.status = command.result;
    this.decisions.push(decision);
    return { kind: "DECIDED", decision };
  }

  public currentStatus(): ReportStatus | undefined {
    return this.status;
  }

  public markMissing(): void {
    this.status = undefined;
  }
}

function serviceFor(repository = new InMemoryDecisionRepository()) {
  return {
    repository,
    service: new HazardVerificationService(repository, () => decidedAt),
  };
}

describe("HazardVerificationService decision workflow", () => {
  it("atomically records a VERIFIED decision for a pending report", async () => {
    const { repository, service } = serviceFor();

    const decision = await service.decideReport({
      reportId,
      officerId: officerOne,
      result: VerificationResult.VERIFIED,
    });

    expect(decision).toMatchObject({
      reportId,
      officerId: officerOne,
      result: VerificationResult.VERIFIED,
      reason: null,
      decidedAt,
    });
    expect(repository.currentStatus()).toBe(ReportStatus.VERIFIED);
    expect(repository.decisions).toHaveLength(1);
  });

  it("persists trimmed optional notes for a VERIFIED decision", async () => {
    const { repository, service } = serviceFor();

    const decision = await service.decideReport({
      reportId,
      officerId: officerOne,
      result: VerificationResult.VERIFIED,
      reason: "  Evidence reviewed against the reported location.  ",
    });

    expect(decision.reason).toBe("Evidence reviewed against the reported location.");
    expect(repository.decisions[0]?.reason).toBe(
      "Evidence reviewed against the reported location.",
    );
    expect(repository.currentStatus()).toBe(ReportStatus.VERIFIED);
  });

  it("stores whitespace-only VERIFIED notes as absent", async () => {
    const { repository, service } = serviceFor();

    const decision = await service.decideReport({
      reportId,
      officerId: officerOne,
      result: VerificationResult.VERIFIED,
      reason: "  \t  ",
    });

    expect(decision.reason).toBeNull();
    expect(repository.decisions[0]?.reason).toBeNull();
  });

  it("records a trimmed rejection reason with officer and timestamp", async () => {
    const { repository, service } = serviceFor();

    const decision = await service.decideReport({
      reportId,
      officerId: officerOne,
      result: VerificationResult.REJECTED,
      reason: "  Photo is unrelated to the reported flood.  ",
    });

    expect(decision).toMatchObject({
      officerId: officerOne,
      result: VerificationResult.REJECTED,
      reason: "Photo is unrelated to the reported flood.",
      decidedAt,
    });
    expect(repository.currentStatus()).toBe(ReportStatus.REJECTED);
  });

  it.each([
    [undefined, "missing"],
    ["         ", "whitespace only"],
    ["a".repeat(9), "nine characters"],
    ["a".repeat(501), "501 characters"],
  ])("rejects a rejection reason that is %s (%s)", async (reason) => {
    const { repository, service } = serviceFor();

    await expect(
      service.decideReport({
        reportId,
        officerId: officerOne,
        result: VerificationResult.REJECTED,
        reason,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(repository.currentStatus()).toBe(ReportStatus.PENDING);
    expect(repository.decisions).toHaveLength(0);
  });

  it.each(["a".repeat(10), "a".repeat(500)])(
    "accepts a rejection reason of %s characters",
    async (reason) => {
      const { service } = serviceFor();

      await expect(
        service.decideReport({
          reportId,
          officerId: officerOne,
          result: VerificationResult.REJECTED,
          reason,
        }),
      ).resolves.toMatchObject({ reason });
    },
  );

  it("rejects invalid verification results without mutating the report", async () => {
    const { repository, service } = serviceFor();

    await expect(
      service.decideReport({
        reportId,
        officerId: officerOne,
        result: "PENDING" as VerificationResult,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(repository.currentStatus()).toBe(ReportStatus.PENDING);
  });

  it.each([ReportStatus.VERIFIED, ReportStatus.REJECTED])(
    "does not overwrite a %s report",
    async (status) => {
      const { repository, service } = serviceFor(new InMemoryDecisionRepository(status));

      await expect(
        service.decideReport({
          reportId,
          officerId: officerOne,
          result: VerificationResult.VERIFIED,
        }),
      ).rejects.toEqual(new ReportAlreadyProcessedError(status));
      expect(repository.decisions).toHaveLength(0);
    },
  );

  it("returns not found without creating a decision", async () => {
    const { repository, service } = serviceFor();
    repository.markMissing();

    await expect(
      service.decideReport({
        reportId,
        officerId: officerOne,
        result: VerificationResult.VERIFIED,
      }),
    ).rejects.toEqual(new ReportNotFoundError(reportId));
    expect(repository.decisions).toHaveLength(0);
  });

  it("leaves the pending report unchanged when persistence fails", async () => {
    const repository = new InMemoryDecisionRepository();
    repository.failNextDecision = true;
    const { service } = serviceFor(repository);

    await expect(
      service.decideReport({
        reportId,
        officerId: officerOne,
        result: VerificationResult.VERIFIED,
      }),
    ).rejects.toThrow("Database write failed.");
    expect(repository.currentStatus()).toBe(ReportStatus.PENDING);
    expect(repository.decisions).toHaveLength(0);
  });

  it("allows one concurrent officer decision and rejects the loser without a duplicate audit", async () => {
    const { repository, service } = serviceFor();

    const outcomes = await Promise.allSettled([
      service.decideReport({
        reportId,
        officerId: officerOne,
        result: VerificationResult.VERIFIED,
      }),
      service.decideReport({
        reportId,
        officerId: officerTwo,
        result: VerificationResult.REJECTED,
        reason: "Photo does not show a hazard at this location.",
      }),
    ]);

    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === "rejected")[0]?.reason).toBeInstanceOf(
      ReportAlreadyProcessedError,
    );
    expect(repository.decisions).toHaveLength(1);
  });

  it("maps a repeated final decision to already processed without creating a duplicate", async () => {
    const { repository, service } = serviceFor();
    await service.decideReport({
      reportId,
      officerId: officerOne,
      result: VerificationResult.VERIFIED,
    });

    await expect(
      service.decideReport({
        reportId,
        officerId: officerOne,
        result: VerificationResult.VERIFIED,
      }),
    ).rejects.toEqual(new ReportAlreadyProcessedError(ReportStatus.VERIFIED));
    expect(repository.decisions).toHaveLength(1);
  });
});

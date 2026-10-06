import { HazardType, LocationSource, ReportStatus } from "@disaster/domain";
import { describe, expect, it, vi } from "vitest";
import { HazardVerificationService } from "./hazard-verification.service.js";
import type { HazardVerificationRepository, ReportForReview } from "./types.js";
import { ReportNotFoundError } from "./types.js";

const pendingReport = {
  id: "40000000-0000-4000-8000-000000000001",
  status: ReportStatus.PENDING,
  hazardType: HazardType.FLOOD,
  submittedAt: new Date("2026-09-25T10:00:00.000Z"),
  requiresExtraReview: false,
} as const;

const extraReviewReport: ReportForReview = {
  ...pendingReport,
  id: "40000000-0000-4000-8000-000000000002",
  requiresExtraReview: true,
  description: "Fresh soil movement is visible above the village road.",
  photoRef: "seed://photos/landslide.jpg",
  location: {
    latitude: 6.9271,
    longitude: 79.8612,
    districtId: "00000000-0000-4000-8000-000000000001",
    address: "Colombo hazard point",
    source: LocationSource.GPS,
  },
};

function repositoryStub(overrides: Partial<HazardVerificationRepository> = {}) {
  return {
    listPendingReports: vi.fn(async () => [pendingReport]),
    findReportForReview: vi.fn(async () => extraReviewReport),
    ...overrides,
  } satisfies HazardVerificationRepository;
}

describe("HazardVerificationService", () => {
  it("returns every pending report supplied by the read repository", async () => {
    const repository = repositoryStub({
      listPendingReports: vi.fn(async () => [pendingReport, extraReviewReport]),
    });
    const service = new HazardVerificationService(repository);

    await expect(service.listPendingReports()).resolves.toEqual([pendingReport, extraReviewReport]);
    expect(repository.listPendingReports).toHaveBeenCalledOnce();
  });

  it("returns an empty queue without treating it as an error", async () => {
    const repository = repositoryStub({ listPendingReports: vi.fn(async () => []) });
    const service = new HazardVerificationService(repository);

    await expect(service.listPendingReports()).resolves.toEqual([]);
  });

  it("returns the frozen evidence and location review dataset", async () => {
    const repository = repositoryStub();
    const service = new HazardVerificationService(repository);

    await expect(service.getReportForReview(extraReviewReport.id)).resolves.toEqual(
      extraReviewReport,
    );
    expect(repository.findReportForReview).toHaveBeenCalledWith(extraReviewReport.id);
  });

  it("keeps requiresExtraReview as returned advisory context", async () => {
    const repository = repositoryStub();
    const service = new HazardVerificationService(repository);

    const report = await service.getReportForReview(extraReviewReport.id);
    expect(report.requiresExtraReview).toBe(true);
    expect(report.status).toBe(ReportStatus.PENDING);
  });

  it("uses the established not-found error when a report does not exist", async () => {
    const reportId = "40000000-0000-4000-8000-000000000099";
    const repository = repositoryStub({ findReportForReview: vi.fn(async () => null) });
    const service = new HazardVerificationService(repository);

    await expect(service.getReportForReview(reportId)).rejects.toEqual(
      new ReportNotFoundError(reportId),
    );
  });

  it("does not create decisions or mutate state while reading reports", async () => {
    const original = structuredClone(extraReviewReport);
    const repository = repositoryStub();
    const service = new HazardVerificationService(repository);

    await service.listPendingReports();
    await service.getReportForReview(extraReviewReport.id);

    expect(extraReviewReport).toEqual(original);
    expect(Object.keys(repository)).toEqual(["listPendingReports", "findReportForReview"]);
  });
});

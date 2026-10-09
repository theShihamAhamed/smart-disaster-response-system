import { ReportStatus } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { PrismaHazardVerificationRepository } from "./hazard-verification.repository.js";

function prismaStub() {
  const prisma = {
    hazardReport: {
      findMany: vi.fn(async () => []),
      findUnique: vi.fn(async () => null),
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
    verificationDecision: {
      create: vi.fn(),
      findUnique: vi.fn(async () => null),
    },
    $transaction: vi.fn(),
  };
  prisma.$transaction.mockImplementation(async (operation) => operation(prisma));
  return prisma;
}

describe("PrismaHazardVerificationRepository", () => {
  it("queries only pending reports for the officer queue", async () => {
    const prisma = prismaStub();
    const repository = new PrismaHazardVerificationRepository(prisma as never);

    await expect(repository.listPendingReports()).resolves.toEqual([]);
    expect(prisma.hazardReport.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: ReportStatus.PENDING }) }),
    );
  });

  it("does not include final reports in the pending query", async () => {
    const prisma = prismaStub();
    const repository = new PrismaHazardVerificationRepository(prisma as never);

    await repository.listPendingReports();

    const query = prisma.hazardReport.findMany.mock.calls[0][0];
    expect(query.where.status).toBe(ReportStatus.PENDING);
    expect(query.where.status).not.toBe(ReportStatus.VERIFIED);
    expect(query.where.status).not.toBe(ReportStatus.REJECTED);
    expect(query.where.verificationDecision).toEqual({ is: null });
  });

  it("loads only the frozen review fields and converts coordinates to numbers", async () => {
    const prisma = prismaStub();
    prisma.hazardReport.findUnique.mockResolvedValue({
      id: "40000000-0000-4000-8000-000000000001",
      status: ReportStatus.PENDING,
      hazardType: "FLOOD",
      description: "Flood water is crossing the main road.",
      photoRef: "seed://photos/pending-flood.jpg",
      submittedAt: new Date("2026-09-25T10:00:00.000Z"),
      requiresExtraReview: true,
      location: {
        latitude: { toString: () => "6.9271" },
        longitude: { toString: () => "79.8612" },
        districtId: "00000000-0000-4000-8000-000000000001",
        address: "Colombo hazard point",
        source: "GPS",
      },
    });
    const repository = new PrismaHazardVerificationRepository(prisma as never);

    await expect(
      repository.findReportForReview("40000000-0000-4000-8000-000000000001"),
    ).resolves.toMatchObject({
      requiresExtraReview: true,
      location: { latitude: 6.9271, longitude: 79.8612, source: "GPS" },
    });
    expect(prisma.hazardReport.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "40000000-0000-4000-8000-000000000001" } }),
    );
  });

  it("returns null when no reviewable report exists", async () => {
    const prisma = prismaStub();
    const repository = new PrismaHazardVerificationRepository(prisma as never);

    await expect(
      repository.findReportForReview("40000000-0000-4000-8000-000000000099"),
    ).resolves.toBeNull();
  });

  it("uses one transaction to conditionally transition and audit a pending report", async () => {
    const prisma = prismaStub();
    prisma.hazardReport.findUnique.mockResolvedValue({
      status: ReportStatus.PENDING,
      verificationDecision: null,
    });
    prisma.hazardReport.updateMany.mockResolvedValue({ count: 1 });
    prisma.verificationDecision.create.mockResolvedValue({
      id: "42000000-0000-4000-8000-000000000001",
      reportId: "40000000-0000-4000-8000-000000000001",
      officerId: "10000000-0000-4000-8000-000000000003",
      result: ReportStatus.VERIFIED,
      reason: null,
      decidedAt: new Date("2026-10-05T10:00:00.000Z"),
    });
    const repository = new PrismaHazardVerificationRepository(prisma as never);

    await expect(
      repository.decidePendingReport({
        reportId: "40000000-0000-4000-8000-000000000001",
        officerId: "10000000-0000-4000-8000-000000000003",
        result: ReportStatus.VERIFIED,
        decidedAt: new Date("2026-10-05T10:00:00.000Z"),
      }),
    ).resolves.toMatchObject({ kind: "DECIDED", decision: { reason: null } });
    expect(prisma.$transaction).toHaveBeenCalledOnce();
    expect(prisma.hazardReport.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "40000000-0000-4000-8000-000000000001", status: ReportStatus.PENDING },
        data: { status: ReportStatus.VERIFIED },
      }),
    );
    expect(prisma.verificationDecision.create).toHaveBeenCalledOnce();
  });

  it("persists VERIFIED notes in the existing nullable reason field", async () => {
    const prisma = prismaStub();
    prisma.hazardReport.findUnique.mockResolvedValue({
      status: ReportStatus.PENDING,
      verificationDecision: null,
    });
    prisma.hazardReport.updateMany.mockResolvedValue({ count: 1 });
    prisma.verificationDecision.create.mockResolvedValue({
      id: "42000000-0000-4000-8000-000000000002",
      reportId: "40000000-0000-4000-8000-000000000001",
      officerId: "10000000-0000-4000-8000-000000000003",
      result: ReportStatus.VERIFIED,
      reason: "Evidence reviewed.",
      decidedAt: new Date("2026-10-05T10:00:00.000Z"),
    });
    const repository = new PrismaHazardVerificationRepository(prisma as never);

    await repository.decidePendingReport({
      reportId: "40000000-0000-4000-8000-000000000001",
      officerId: "10000000-0000-4000-8000-000000000003",
      result: ReportStatus.VERIFIED,
      reason: "Evidence reviewed.",
      decidedAt: new Date("2026-10-05T10:00:00.000Z"),
    });

    expect(prisma.verificationDecision.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ reason: "Evidence reviewed." }) }),
    );
  });

  it.each([ReportStatus.VERIFIED, ReportStatus.REJECTED])(
    "returns the frozen conflict for an already-%s report without creating a decision",
    async (status) => {
      const prisma = prismaStub();
      prisma.hazardReport.findUnique.mockResolvedValue({ status, verificationDecision: null });
      const repository = new PrismaHazardVerificationRepository(prisma as never);

      await expect(
        repository.decidePendingReport({
          reportId: "40000000-0000-4000-8000-000000000001",
          officerId: "10000000-0000-4000-8000-000000000003",
          result: ReportStatus.VERIFIED,
          decidedAt: new Date("2026-10-05T10:00:00.000Z"),
        }),
      ).resolves.toEqual({ kind: "REPORT_ALREADY_PROCESSED", status });
      expect(prisma.hazardReport.updateMany).not.toHaveBeenCalled();
      expect(prisma.verificationDecision.create).not.toHaveBeenCalled();
    },
  );

  it("returns the frozen conflict for a stale pending report with an existing decision", async () => {
    const prisma = prismaStub();
    prisma.hazardReport.findUnique.mockResolvedValue({
      status: ReportStatus.PENDING,
      verificationDecision: { result: "REJECTED" },
    });
    const repository = new PrismaHazardVerificationRepository(prisma as never);

    await expect(
      repository.decidePendingReport({
        reportId: "40000000-0000-4000-8000-000000000001",
        officerId: "10000000-0000-4000-8000-000000000003",
        result: ReportStatus.VERIFIED,
        decidedAt: new Date("2026-10-05T10:00:00.000Z"),
      }),
    ).resolves.toEqual({ kind: "REPORT_ALREADY_PROCESSED", status: ReportStatus.REJECTED });
    expect(prisma.hazardReport.updateMany).not.toHaveBeenCalled();
    expect(prisma.verificationDecision.create).not.toHaveBeenCalled();
  });

  it("maps only the VerificationDecision reportId unique race to the frozen conflict", async () => {
    const prisma = prismaStub();
    prisma.hazardReport.findUnique.mockResolvedValue({
      status: ReportStatus.PENDING,
      verificationDecision: null,
    });
    prisma.hazardReport.updateMany.mockResolvedValue({ count: 1 });
    prisma.verificationDecision.create.mockRejectedValue({
      code: "P2002",
      meta: { target: ["reportId"] },
    });
    prisma.verificationDecision.findUnique.mockResolvedValue({ result: "REJECTED" });
    const repository = new PrismaHazardVerificationRepository(prisma as never);

    await expect(
      repository.decidePendingReport({
        reportId: "40000000-0000-4000-8000-000000000001",
        officerId: "10000000-0000-4000-8000-000000000003",
        result: ReportStatus.VERIFIED,
        decidedAt: new Date("2026-10-05T10:00:00.000Z"),
      }),
    ).resolves.toEqual({ kind: "REPORT_ALREADY_PROCESSED", status: ReportStatus.REJECTED });
    expect(prisma.verificationDecision.create).toHaveBeenCalledOnce();
    expect(prisma.verificationDecision.findUnique).toHaveBeenCalledWith({
      where: { reportId: "40000000-0000-4000-8000-000000000001" },
      select: { result: true },
    });
  });

  it("does not map unrelated P2002 errors to report already processed", async () => {
    const prisma = prismaStub();
    prisma.hazardReport.findUnique.mockResolvedValue({
      status: ReportStatus.PENDING,
      verificationDecision: null,
    });
    prisma.hazardReport.updateMany.mockResolvedValue({ count: 1 });
    const databaseError = { code: "P2002", meta: { target: ["id"] } };
    prisma.verificationDecision.create.mockRejectedValue(databaseError);
    const repository = new PrismaHazardVerificationRepository(prisma as never);

    await expect(
      repository.decidePendingReport({
        reportId: "40000000-0000-4000-8000-000000000001",
        officerId: "10000000-0000-4000-8000-000000000003",
        result: ReportStatus.VERIFIED,
        decidedAt: new Date("2026-10-05T10:00:00.000Z"),
      }),
    ).rejects.toBe(databaseError);
    expect(prisma.verificationDecision.findUnique).not.toHaveBeenCalled();
  });

  it("derives a final review status from an existing decision in stale data", async () => {
    const prisma = prismaStub();
    prisma.hazardReport.findUnique.mockResolvedValue({
      id: "40000000-0000-4000-8000-000000000001",
      status: ReportStatus.PENDING,
      verificationDecision: { result: "VERIFIED" },
      hazardType: "FLOOD",
      description: "Flood water is crossing the main road.",
      photoRef: "seed://photos/pending-flood.jpg",
      submittedAt: new Date("2026-09-25T10:00:00.000Z"),
      requiresExtraReview: true,
      location: {
        latitude: { toString: () => "6.9271" },
        longitude: { toString: () => "79.8612" },
        districtId: "00000000-0000-4000-8000-000000000001",
        address: "Colombo hazard point",
        source: "GPS",
      },
    });
    const repository = new PrismaHazardVerificationRepository(prisma as never);

    await expect(
      repository.findReportForReview("40000000-0000-4000-8000-000000000001"),
    ).resolves.toMatchObject({ status: ReportStatus.VERIFIED });
  });
});

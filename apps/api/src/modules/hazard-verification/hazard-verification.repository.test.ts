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
      expect.objectContaining({ where: { status: ReportStatus.PENDING } }),
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
});

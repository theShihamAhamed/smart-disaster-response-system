import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { PrismaHazardSubmissionRepository } from "./hazard-submission.repository.js";
import type { NewHazardReport } from "./types.js";

const now = new Date("2026-10-05T10:00:00.000Z");
const row = {
  id: "r1",
  clientReportId: "c1",
  reporterId: "u1",
  hazardType: "FLOOD",
  status: "PENDING",
  outsideAssignedArea: false,
  requiresExtraReview: false,
  submittedAt: now,
  verificationDecision: null,
};
const newReport: NewHazardReport = {
  id: "r1",
  clientReportId: "c1",
  reporterId: "u1",
  hazardType: "FLOOD",
  description: "Flood water is crossing the road.",
  photoRef: "p",
  submittedAt: now,
  outsideAssignedArea: false,
  requiresExtraReview: false,
  location: { id: "l1", latitude: 6.9, longitude: 79.8, districtId: "d1", source: "GPS" },
};

function fakePrisma(hazardReport: Record<string, unknown>) {
  return { hazardReport } as unknown as PrismaClient;
}

describe("PrismaHazardSubmissionRepository", () => {
  it("creates the report with a nested location and a connected reporter", async () => {
    const create = vi.fn().mockResolvedValue(row);
    const repo = new PrismaHazardSubmissionRepository(fakePrisma({ create }));
    const result = await repo.create(newReport);
    expect(result.created).toBe(true);
    const data = create.mock.calls[0]?.[0].data;
    expect(data).toMatchObject({
      status: "PENDING",
      reporter: { connect: { id: "u1" } },
      location: { create: newReport.location },
    });
  });

  it("returns the existing report when a concurrent request wins the unique index", async () => {
    const create = vi.fn().mockRejectedValue({ code: "P2002" });
    const findUnique = vi.fn().mockResolvedValue(row);
    const result = await new PrismaHazardSubmissionRepository(
      fakePrisma({ create, findUnique }),
    ).create(newReport);
    expect(result).toMatchObject({ created: false, record: { id: "r1" } });
  });

  it("rethrows other database errors and unique errors with no matching row", async () => {
    const boom = new Error("db down");
    const repoA = new PrismaHazardSubmissionRepository(
      fakePrisma({ create: vi.fn().mockRejectedValue(boom) }),
    );
    await expect(repoA.create(newReport)).rejects.toBe(boom);

    const repoB = new PrismaHazardSubmissionRepository(
      fakePrisma({
        create: vi.fn().mockRejectedValue({ code: "P2002" }),
        findUnique: vi.fn().mockResolvedValue(null),
      }),
    );
    await expect(repoB.create(newReport)).rejects.toEqual({ code: "P2002" });
  });

  it("maps the rejection reason only for REJECTED decisions", async () => {
    const findUnique = vi
      .fn()
      .mockResolvedValueOnce({
        ...row,
        status: "REJECTED",
        verificationDecision: { result: "REJECTED", reason: "Not a flood." },
      })
      .mockResolvedValueOnce({ ...row, verificationDecision: { result: "VERIFIED", reason: null } })
      .mockResolvedValueOnce(null);
    const repo = new PrismaHazardSubmissionRepository(fakePrisma({ findUnique }));
    expect((await repo.findById("r1"))?.rejectionReason).toBe("Not a flood.");
    expect((await repo.findByClientReportId("c1"))?.rejectionReason).toBeNull();
    expect(await repo.findById("none")).toBeNull();
  });
});

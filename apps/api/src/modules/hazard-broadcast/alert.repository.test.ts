import { AlertSeverity, AlertStatus, HazardType } from "@disaster/domain";
import { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { PrismaHazardBroadcastRepository } from "./alert.repository.js";
import type { CreateInitialAlertCommand } from "./types.js";

const officerId = "10000000-0000-4000-8000-000000000004";
const reportId = "40000000-0000-4000-8000-000000000001";
const alertId = "50000000-0000-4000-8000-000000000001";

const sampleAlertRow = {
  id: alertId,
  sourceReportId: reportId,
  createdByOfficerId: officerId,
  hazardType: HazardType.FLOOD,
  severity: AlertSeverity.ADVISORY,
  message: "",
  safetyInstructions: "",
  status: AlertStatus.DRAFT,
  version: 1,
  parentAlertId: null,
  issuedAt: null,
  cancelledAt: null,
  cancellationReason: null,
  targetZones: [],
};

const command: CreateInitialAlertCommand = {
  sourceReportId: reportId,
  createdByOfficerId: officerId,
  hazardType: HazardType.FLOOD,
  severity: AlertSeverity.ADVISORY,
  message: "",
  safetyInstructions: "",
  status: AlertStatus.DRAFT,
  version: 1,
  parentAlertId: null,
};

describe("PrismaHazardBroadcastRepository", () => {
  it("creates a new initial Alert when none exists", async () => {
    const mockPrisma = {
      hazardReport: { findUnique: vi.fn() },
      alert: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue(sampleAlertRow),
      },
    };

    const repository = new PrismaHazardBroadcastRepository(mockPrisma as any);
    const result = await repository.createInitialAlert(command);

    expect(result.kind).toBe("CREATED");
    expect(result.alert.id).toBe(alertId);
    expect(mockPrisma.alert.create).toHaveBeenCalledTimes(1);
  });

  it("returns existing Alert without creating a duplicate if already present", async () => {
    const mockPrisma = {
      hazardReport: { findUnique: vi.fn() },
      alert: {
        findFirst: vi.fn().mockResolvedValue(sampleAlertRow),
        create: vi.fn(),
      },
    };

    const repository = new PrismaHazardBroadcastRepository(mockPrisma as any);
    const result = await repository.createInitialAlert(command);

    expect(result.kind).toBe("EXISTING");
    expect(result.alert.id).toBe(alertId);
    expect(mockPrisma.alert.create).not.toHaveBeenCalled();
  });

  it("handles concurrent P2002 unique constraint error by safely returning the existing alert", async () => {
    let callCount = 0;
    const mockPrisma = {
      hazardReport: { findUnique: vi.fn() },
      alert: {
        findFirst: vi.fn().mockImplementation(async () => {
          callCount++;
          // First check returns null (simulating race before insert), second check returns the winning alert
          return callCount > 1 ? sampleAlertRow : null;
        }),
        create: vi.fn().mockRejectedValue(
          new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
            code: "P2002",
            clientVersion: "6.16.2",
          }),
        ),
      },
    };

    const repository = new PrismaHazardBroadcastRepository(mockPrisma as any);
    const result = await repository.createInitialAlert(command);

    expect(result.kind).toBe("EXISTING");
    expect(result.alert.id).toBe(alertId);
  });
});

import {
  AlertSeverity,
  AlertStatus,
  DeliveryStatus,
  HazardType,
  ZoneSeverity,
} from "@disaster/domain";
import { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { PrismaHazardBroadcastRepository } from "./alert.repository.js";
import type { CreateInitialAlertCommand, UpdateDraftAlertCommand } from "./types.js";

const officerId = "10000000-0000-4000-8000-000000000004";
const reportId = "40000000-0000-4000-8000-000000000001";
const alertId = "50000000-0000-4000-8000-000000000001";
const zone1 = "30000000-0000-4000-8000-000000000001";

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

const updateCommand: UpdateDraftAlertCommand = {
  alertId,
  severity: AlertSeverity.WARNING,
  message: "Rising waters",
  safetyInstructions: "Move upstairs",
  targetZoneIds: [zone1],
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

  it("updates draft alert and replaces target zones atomically in a transaction", async () => {
    const txAlertUpdate = vi.fn().mockResolvedValue({ id: alertId });
    const txDeleteMany = vi.fn().mockResolvedValue({ count: 0 });
    const txCreateMany = vi.fn().mockResolvedValue({ count: 1 });
    const txFindUniqueOrThrow = vi.fn().mockResolvedValue({
      ...sampleAlertRow,
      severity: AlertSeverity.WARNING,
      message: "Rising waters",
      safetyInstructions: "Move upstairs",
      targetZones: [{ targetZoneId: zone1 }],
    });

    const mockPrisma = {
      $transaction: vi.fn(async (callback) => {
        return callback({
          alert: {
            update: txAlertUpdate,
            findUniqueOrThrow: txFindUniqueOrThrow,
          },
          alertTargetZone: {
            deleteMany: txDeleteMany,
            createMany: txCreateMany,
          },
        });
      }),
    };

    const repository = new PrismaHazardBroadcastRepository(mockPrisma as any);
    const updated = await repository.updateDraftAlert(updateCommand);

    expect(updated.id).toBe(alertId);
    expect(updated.severity).toBe(AlertSeverity.WARNING);
    expect(updated.message).toBe("Rising waters");
    expect(updated.safetyInstructions).toBe("Move upstairs");
    expect(updated.targetZoneIds).toEqual([zone1]);
    expect(txAlertUpdate).toHaveBeenCalledWith({
      where: { id: alertId },
      data: {
        severity: AlertSeverity.WARNING,
        message: "Rising waters",
        safetyInstructions: "Move upstairs",
      },
    });
    expect(txDeleteMany).toHaveBeenCalledWith({ where: { alertId } });
    expect(txCreateMany).toHaveBeenCalledWith({
      data: [{ alertId, targetZoneId: zone1 }],
    });
  });

  it("finds alert preview including joined target zone details", async () => {
    const mockPrisma = {
      alert: {
        findUnique: vi.fn().mockResolvedValue({
          ...sampleAlertRow,
          severity: AlertSeverity.WARNING,
          message: "Flood Warning",
          safetyInstructions: "Move to high ground",
          targetZones: [
            {
              targetZone: {
                id: zone1,
                name: "Colombo Critical Flood Zone",
                districtId: "00000000-0000-4000-8000-000000000001",
                severity: ZoneSeverity.CRITICAL,
                geometryRef: "geo:colombo-critical-v1",
              },
            },
          ],
        }),
      },
    };

    const repository = new PrismaHazardBroadcastRepository(mockPrisma as any);
    const preview = await repository.findAlertPreview(alertId);

    expect(preview).not.toBeNull();
    expect(preview?.alert.id).toBe(alertId);
    expect(preview?.targetZones).toHaveLength(1);
    expect(preview?.targetZones[0]?.name).toBe("Colombo Critical Flood Zone");
    expect(preview?.targetZones[0]?.severity).toBe(ZoneSeverity.CRITICAL);
  });

  it("finds similar active alerts by matching status ACTIVE, same hazardType, and overlapping target zones", async () => {
    const activeAlertRow = {
      ...sampleAlertRow,
      id: "50000000-0000-4000-8000-000000000002",
      status: AlertStatus.ACTIVE,
      hazardType: HazardType.FLOOD,
      issuedAt: new Date("2026-10-06T10:00:00Z"),
      targetZones: [{ targetZoneId: zone1 }],
    };

    const mockPrisma = {
      alert: {
        findMany: vi.fn().mockResolvedValue([activeAlertRow]),
      },
    };

    const repository = new PrismaHazardBroadcastRepository(mockPrisma as any);
    const similar = await repository.findSimilarActiveAlerts({
      hazardType: HazardType.FLOOD,
      targetZoneIds: [zone1],
      excludeAlertId: alertId,
    });

    expect(similar).toHaveLength(1);
    expect(similar[0]?.id).toBe("50000000-0000-4000-8000-000000000002");
    expect(similar[0]?.status).toBe(AlertStatus.ACTIVE);
    expect(similar[0]?.targetZoneIds).toEqual([zone1]);
    expect(mockPrisma.alert.findMany).toHaveBeenCalledWith({
      where: {
        status: AlertStatus.ACTIVE,
        hazardType: HazardType.FLOOD,
        id: { not: alertId },
        targetZones: {
          some: {
            targetZoneId: {
              in: [zone1],
            },
          },
        },
      },
      select: expect.any(Object),
      orderBy: {
        issuedAt: "desc",
      },
    });
  });

  it("returns empty array without querying database if targetZoneIds is empty", async () => {
    const mockPrisma = {
      alert: {
        findMany: vi.fn(),
      },
    };

    const repository = new PrismaHazardBroadcastRepository(mockPrisma as any);
    const similar = await repository.findSimilarActiveAlerts({
      hazardType: HazardType.FLOOD,
      targetZoneIds: [],
    });

    expect(similar).toEqual([]);
    expect(mockPrisma.alert.findMany).not.toHaveBeenCalled();
  });

  it("activates draft alert atomically, sets status ACTIVE, creates audit record and returns result", async () => {
    const fixedNow = new Date("2026-10-06T12:00:00Z");
    const draftAlertRow = {
      ...sampleAlertRow,
      status: AlertStatus.DRAFT,
      targetZones: [{ targetZoneId: zone1 }],
    };
    const activeAlertRow = {
      ...draftAlertRow,
      status: AlertStatus.ACTIVE,
      issuedAt: fixedNow,
    };

    const txAlertFindUnique = vi.fn().mockResolvedValue(draftAlertRow);
    const txAlertUpdate = vi.fn().mockResolvedValue(activeAlertRow);
    const txBroadcastAuditCreate = vi.fn().mockResolvedValue({ id: "audit-1" });
    const txNotificationDeliveryCreate = vi.fn();

    const mockPrisma = {
      $transaction: vi.fn(async (callback) => {
        return callback({
          alert: {
            findUnique: txAlertFindUnique,
            update: txAlertUpdate,
          },
          broadcastAudit: {
            create: txBroadcastAuditCreate,
          },
          notificationDelivery: {
            create: txNotificationDeliveryCreate,
          },
        });
      }),
    };

    const repository = new PrismaHazardBroadcastRepository(mockPrisma as any);
    const result = await repository.activateAlert({
      alertId,
      officerId,
      issuedAt: fixedNow,
    });

    expect(result.alert.id).toBe(alertId);
    expect(result.alert.status).toBe(AlertStatus.ACTIVE);
    expect(result.alert.issuedAt).toEqual(fixedNow);
    expect(result.deliveries).toEqual([]);

    expect(txAlertUpdate).toHaveBeenCalledWith({
      where: {
        id: alertId,
        status: AlertStatus.DRAFT,
      },
      data: {
        status: AlertStatus.ACTIVE,
        issuedAt: fixedNow,
      },
      select: expect.any(Object),
    });

    expect(txBroadcastAuditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        alertId,
        officerId,
        action: "ACTIVATED",
        createdAt: fixedNow,
      }),
    });
  });

  it("creates PENDING notification deliveries if recipientRefs are provided", async () => {
    const fixedNow = new Date("2026-10-06T12:00:00Z");
    const draftAlertRow = {
      ...sampleAlertRow,
      status: AlertStatus.DRAFT,
      targetZones: [{ targetZoneId: zone1 }],
    };
    const activeAlertRow = {
      ...draftAlertRow,
      status: AlertStatus.ACTIVE,
      issuedAt: fixedNow,
    };

    const txAlertFindUnique = vi.fn().mockResolvedValue(draftAlertRow);
    const txAlertUpdate = vi.fn().mockResolvedValue(activeAlertRow);
    const txBroadcastAuditCreate = vi.fn().mockResolvedValue({ id: "audit-1" });
    const txNotificationDeliveryCreate = vi.fn().mockImplementation(async ({ data }) => ({
      ...data,
      id: "deliv-1",
    }));

    const mockPrisma = {
      $transaction: vi.fn(async (callback) => {
        return callback({
          alert: {
            findUnique: txAlertFindUnique,
            update: txAlertUpdate,
          },
          broadcastAudit: {
            create: txBroadcastAuditCreate,
          },
          notificationDelivery: {
            create: txNotificationDeliveryCreate,
          },
        });
      }),
    };

    const repository = new PrismaHazardBroadcastRepository(mockPrisma as any);
    const result = await repository.activateAlert({
      alertId,
      officerId,
      recipientRefs: ["recipient-001"],
      issuedAt: fixedNow,
    });

    expect(result.deliveries).toHaveLength(1);
    expect(result.deliveries[0]?.recipientRef).toBe("recipient-001");
    expect(result.deliveries[0]?.status).toBe(DeliveryStatus.PENDING);
    expect(result.deliveries[0]?.attemptNo).toBe(0);
  });

  it("creates a replacement draft with incremented version and parentAlertId atomically", async () => {
    const replacementId = "50000000-0000-4000-8000-000000000099";
    const createdReplacementRow = {
      id: replacementId,
      sourceReportId: reportId,
      createdByOfficerId: officerId,
      hazardType: HazardType.FLOOD,
      severity: AlertSeverity.WARNING,
      message: "Rising waters",
      safetyInstructions: "Move upstairs",
      status: AlertStatus.DRAFT,
      version: 2,
      parentAlertId: alertId,
      issuedAt: null,
      cancelledAt: null,
      cancellationReason: null,
      targetZones: [{ targetZoneId: zone1 }],
    };

    const txAlertCreate = vi.fn().mockResolvedValue(createdReplacementRow);
    const txAlertTargetZoneCreateMany = vi.fn().mockResolvedValue({ count: 1 });
    const txAlertFindUniqueOrThrow = vi.fn().mockResolvedValue(createdReplacementRow);

    const mockPrisma = {
      $transaction: vi.fn(async (callback) => {
        return callback({
          alert: {
            create: txAlertCreate,
            findUniqueOrThrow: txAlertFindUniqueOrThrow,
          },
          alertTargetZone: {
            createMany: txAlertTargetZoneCreateMany,
          },
        });
      }),
    };

    const repository = new PrismaHazardBroadcastRepository(mockPrisma as any);
    const result = await repository.createReplacementDraft({
      parentAlertId: alertId,
      sourceReportId: reportId,
      createdByOfficerId: officerId,
      hazardType: HazardType.FLOOD,
      severity: AlertSeverity.WARNING,
      message: "Rising waters",
      safetyInstructions: "Move upstairs",
      status: AlertStatus.DRAFT,
      version: 2,
      targetZoneIds: [zone1],
    });

    expect(result.id).toBe(replacementId);
    expect(result.parentAlertId).toBe(alertId);
    expect(result.version).toBe(2);
    expect(result.status).toBe(AlertStatus.DRAFT);
    expect(result.issuedAt).toBeNull();
    expect(result.cancelledAt).toBeNull();
    expect(result.cancellationReason).toBeNull();
    expect(result.targetZoneIds).toEqual([zone1]);

    expect(txAlertCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        parentAlertId: alertId,
        version: 2,
        status: AlertStatus.DRAFT,
        sourceReportId: reportId,
        createdByOfficerId: officerId,
        hazardType: HazardType.FLOOD,
        severity: AlertSeverity.WARNING,
        message: "Rising waters",
        safetyInstructions: "Move upstairs",
        issuedAt: null,
        cancelledAt: null,
        cancellationReason: null,
      }),
      select: expect.any(Object),
    });

    expect(txAlertTargetZoneCreateMany).toHaveBeenCalledWith({
      data: [{ alertId: expect.any(String), targetZoneId: zone1 }],
    });
  });

  it("cancels an ACTIVE alert atomically in a transaction", async () => {
    const fixedNow = new Date("2026-10-06T12:00:00.000Z");
    const activeAlertRow = {
      ...sampleAlertRow,
      status: AlertStatus.ACTIVE,
      issuedAt: new Date("2026-10-06T10:00:00.000Z"),
      targetZones: [{ targetZoneId: zone1 }],
    };

    const cancelledAlertRow = {
      ...activeAlertRow,
      status: AlertStatus.CANCELLED,
      cancelledAt: fixedNow,
      cancellationReason: "Water receded completely.",
    };

    const txAlertFindUnique = vi.fn().mockResolvedValue(activeAlertRow);
    const txAlertUpdate = vi.fn().mockResolvedValue(cancelledAlertRow);
    const txBroadcastAuditCreate = vi.fn().mockResolvedValue({ id: "audit-1" });
    const txNotificationDeliveryCreate = vi.fn().mockResolvedValue({ id: "deliv-1" });

    const mockPrisma = {
      $transaction: vi.fn(async (callback) => {
        return callback({
          alert: {
            findUnique: txAlertFindUnique,
            update: txAlertUpdate,
          },
          broadcastAudit: {
            create: txBroadcastAuditCreate,
          },
          notificationDelivery: {
            create: txNotificationDeliveryCreate,
          },
        });
      }),
    };

    const repository = new PrismaHazardBroadcastRepository(mockPrisma as any);
    const result = await repository.cancelAlert({
      alertId,
      officerId,
      reason: "Water receded completely.",
      cancelledAt: fixedNow,
      recipientRefs: ["recipient-1"],
    });

    expect(result.id).toBe(alertId);
    expect(result.status).toBe(AlertStatus.CANCELLED);
    expect(result.cancelledAt).toEqual(fixedNow);
    expect(result.cancellationReason).toBe("Water receded completely.");

    expect(txAlertUpdate).toHaveBeenCalledWith({
      where: { id: alertId, status: AlertStatus.ACTIVE },
      data: {
        status: AlertStatus.CANCELLED,
        cancelledAt: fixedNow,
        cancellationReason: "Water receded completely.",
      },
      select: expect.any(Object),
    });

    expect(txBroadcastAuditCreate).toHaveBeenCalledWith({
      data: {
        id: expect.any(String),
        alertId,
        officerId,
        action: "CANCELLED",
        reason: "Water receded completely.",
        createdAt: fixedNow,
      },
    });

    expect(txNotificationDeliveryCreate).toHaveBeenCalledWith({
      data: {
        id: expect.any(String),
        alertId,
        recipientRef: "recipient-1",
        status: DeliveryStatus.PENDING,
        attemptNo: 0,
        lastFailureReason: null,
        updatedAt: fixedNow,
      },
    });
  });

  it("finds and maps notification deliveries by alertId", async () => {
    const deliveryRow = {
      id: "deliv-1",
      alertId,
      recipientRef: "citizen-1",
      status: DeliveryStatus.PENDING,
      attemptNo: 0,
      lastFailureReason: null,
      updatedAt: new Date("2026-10-06T10:00:00.000Z"),
    };

    const mockPrisma = {
      notificationDelivery: {
        findMany: vi.fn().mockResolvedValue([deliveryRow]),
      },
    };

    const repository = new PrismaHazardBroadcastRepository(mockPrisma as any);
    const results = await repository.findDeliveriesByAlertId(alertId);

    expect(results).toHaveLength(1);
    expect(results[0]).toEqual(deliveryRow);
    expect(mockPrisma.notificationDelivery.findMany).toHaveBeenCalledWith({
      where: { alertId },
      orderBy: { updatedAt: "asc" },
    });
  });

  it("finds a single notification delivery by delivery ID", async () => {
    const deliveryRow = {
      id: "deliv-1",
      alertId,
      recipientRef: "citizen-1",
      status: DeliveryStatus.PENDING,
      attemptNo: 0,
      lastFailureReason: null,
      updatedAt: new Date("2026-10-06T10:00:00.000Z"),
    };

    const mockPrisma = {
      notificationDelivery: {
        findUnique: vi.fn().mockResolvedValue(deliveryRow),
      },
    };

    const repository = new PrismaHazardBroadcastRepository(mockPrisma as any);
    const result = await repository.findDeliveryById("deliv-1");

    expect(result).toEqual(deliveryRow);
    expect(mockPrisma.notificationDelivery.findUnique).toHaveBeenCalledWith({
      where: { id: "deliv-1" },
    });
  });

  it("returns null if delivery ID is not found", async () => {
    const mockPrisma = {
      notificationDelivery: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
    };

    const repository = new PrismaHazardBroadcastRepository(mockPrisma as any);
    const result = await repository.findDeliveryById("nonexistent-id");

    expect(result).toBeNull();
  });

  it("updates notification delivery status and attempt number", async () => {
    const updatedRow = {
      id: "deliv-1",
      alertId,
      recipientRef: "citizen-1",
      status: DeliveryStatus.PUSH_SENT,
      attemptNo: 1,
      lastFailureReason: null,
      updatedAt: new Date("2026-10-06T10:05:00.000Z"),
    };

    const mockPrisma = {
      notificationDelivery: {
        update: vi.fn().mockResolvedValue(updatedRow),
      },
    };

    const repository = new PrismaHazardBroadcastRepository(mockPrisma as any);
    const result = await repository.updateDelivery({
      deliveryId: "deliv-1",
      status: DeliveryStatus.PUSH_SENT,
      attemptNo: 1,
      lastFailureReason: null,
      updatedAt: new Date("2026-10-06T10:05:00.000Z"),
    });

    expect(result).toEqual(updatedRow);
    expect(mockPrisma.notificationDelivery.update).toHaveBeenCalledWith({
      where: { id: "deliv-1" },
      data: {
        status: DeliveryStatus.PUSH_SENT,
        attemptNo: 1,
        lastFailureReason: null,
        updatedAt: new Date("2026-10-06T10:05:00.000Z"),
      },
    });
  });

  it("creates a replacement draft with incremented version and parentAlertId", async () => {
    const replacementRow = {
      ...sampleAlertRow,
      id: "50000000-0000-4000-8000-000000000002",
      parentAlertId: alertId,
      version: 2,
      status: AlertStatus.DRAFT,
      targetZones: [{ targetZoneId: zone1 }],
    };

    const mockPrisma = {
      $transaction: vi.fn().mockImplementation(async (callback) => {
        const tx = {
          alert: {
            create: vi.fn().mockResolvedValue(replacementRow),
            findUniqueOrThrow: vi.fn().mockResolvedValue(replacementRow),
          },
          alertTargetZone: {
            createMany: vi.fn().mockResolvedValue({ count: 1 }),
          },
        };
        return callback(tx);
      }),
    };

    const repository = new PrismaHazardBroadcastRepository(mockPrisma as any);
    const result = await repository.createReplacementDraft({
      parentAlertId: alertId,
      sourceReportId: reportId,
      createdByOfficerId: officerId,
      hazardType: HazardType.FLOOD,
      severity: AlertSeverity.WARNING,
      message: "Updated flood alert",
      safetyInstructions: "Move to higher ground",
      status: AlertStatus.DRAFT,
      version: 2,
      targetZoneIds: [zone1],
    });

    expect(result.id).toBe("50000000-0000-4000-8000-000000000002");
    expect(result.parentAlertId).toBe(alertId);
    expect(result.version).toBe(2);
    expect(result.status).toBe(AlertStatus.DRAFT);
  });

  it("activates replacement alert and atomically supersedes parent alert", async () => {
    const parentRow = {
      ...sampleAlertRow,
      id: alertId,
      status: AlertStatus.ACTIVE,
    };

    const replacementRow = {
      ...sampleAlertRow,
      id: "50000000-0000-4000-8000-000000000002",
      parentAlertId: alertId,
      version: 2,
      status: AlertStatus.DRAFT,
    };

    const activatedReplacementRow = {
      ...replacementRow,
      status: AlertStatus.ACTIVE,
      issuedAt: new Date("2026-10-06T11:00:00.000Z"),
    };

    const mockParentUpdate = vi
      .fn()
      .mockResolvedValue({ ...parentRow, status: AlertStatus.SUPERSEDED });
    const mockReplacementUpdate = vi.fn().mockResolvedValue(activatedReplacementRow);
    const mockAuditCreate = vi.fn().mockResolvedValue({ id: "audit-1" });

    const mockPrisma = {
      $transaction: vi.fn().mockImplementation(async (callback) => {
        const tx = {
          alert: {
            findUnique: vi.fn().mockImplementation(({ where }) => {
              if (where.id === "50000000-0000-4000-8000-000000000002")
                return Promise.resolve(replacementRow);
              if (where.id === alertId) return Promise.resolve(parentRow);
              return Promise.resolve(null);
            }),
            update: vi.fn().mockImplementation(({ where }) => {
              if (where.id === alertId) return mockParentUpdate();
              if (where.id === "50000000-0000-4000-8000-000000000002")
                return mockReplacementUpdate();
              return Promise.resolve(null);
            }),
          },
          broadcastAudit: {
            create: mockAuditCreate,
          },
          notificationDelivery: {
            create: vi.fn(),
          },
        };
        return callback(tx);
      }),
    };

    const repository = new PrismaHazardBroadcastRepository(mockPrisma as any);
    const result = await repository.activateAlert({
      alertId: "50000000-0000-4000-8000-000000000002",
      officerId,
      issuedAt: new Date("2026-10-06T11:00:00.000Z"),
    });

    expect(result.alert.status).toBe(AlertStatus.ACTIVE);
    expect(result.alert.id).toBe("50000000-0000-4000-8000-000000000002");
    expect(mockParentUpdate).toHaveBeenCalled();
    expect(mockAuditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          alertId,
          action: "SUPERSEDED",
        }),
      }),
    );
  });
});

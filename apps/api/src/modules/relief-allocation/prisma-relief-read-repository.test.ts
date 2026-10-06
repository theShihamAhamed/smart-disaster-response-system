import { Prisma, type PrismaClient } from "@prisma/client";
import {
  PartnerOrganisationType,
  ReliefRequestStatus,
  RescueTeamStatus,
  SupplyType,
  ZoneSeverity,
} from "@disaster/domain";
import { describe, expect, it, vi } from "vitest";

import { PrismaReliefReadRepository } from "./prisma-relief-read-repository.js";

const districtId = "00000000-0000-4000-8000-000000000001";
const requestId = "70000000-0000-4000-8000-000000000001";
const requestItemId = "71000000-0000-4000-8000-000000000001";

function requestRecord() {
  return {
    id: requestId,
    status: ReliefRequestStatus.PARTIALLY_ALLOCATED,
    priorityNote: "Water remains outstanding.",
    createdAt: new Date("2026-09-25T10:00:00.000Z"),
    version: 3,
    shelter: {
      id: "60000000-0000-4000-8000-000000000001",
      name: "Central Shelter",
      districtId,
      capacity: 200,
      currentOccupancy: 150,
      location: {
        districtId,
        latitude: new Prisma.Decimal("6.927100"),
        longitude: new Prisma.Decimal("79.861200"),
        address: "Central Road",
      },
    },
    targetZone: {
      id: "30000000-0000-4000-8000-000000000001",
      name: "Critical Zone",
      districtId,
      severity: ZoneSeverity.CRITICAL,
    },
    items: [
      {
        id: requestItemId,
        supplyType: SupplyType.WATER,
        requestedQty: 100,
        allocationItems: [
          {
            requestItemId,
            supplyType: SupplyType.WATER,
            allocatedQty: 40,
            allocation: { requestId },
          },
        ],
      },
    ],
  };
}

function client(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    reliefRequest: {
      findMany: vi.fn(async () => []),
      findUnique: vi.fn(async () => null),
    },
    warehouseStock: { findMany: vi.fn(async () => []) },
    partnerOrganisation: { findMany: vi.fn(async () => []) },
    rescueTeam: { findMany: vi.fn(async () => []) },
    ...overrides,
  } as unknown as PrismaClient;
}

describe("Prisma relief read repository", () => {
  it("reads and maps actionable requests using shelter district scope", async () => {
    const prisma = client({
      reliefRequest: {
        findMany: vi.fn(async () => [requestRecord()]),
        findUnique: vi.fn(async () => null),
      },
    });
    const repository = new PrismaReliefReadRepository(prisma);

    const result = await repository.listActionableRequests({ districtId });

    expect(prisma.reliefRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          shelter: { districtId },
          status: {
            in: [
              ReliefRequestStatus.AWAITING_ALLOCATION,
              ReliefRequestStatus.PARTIALLY_ALLOCATED,
              ReliefRequestStatus.AWAITING_RESUPPLY,
            ],
          },
        },
      }),
    );
    expect(result).toEqual([
      expect.objectContaining({
        id: requestId,
        shelter: expect.objectContaining({ name: "Central Shelter" }),
        targetZone: expect.objectContaining({ severity: ZoneSeverity.CRITICAL }),
        items: [
          expect.objectContaining({
            id: requestItemId,
            allocationItems: [
              expect.objectContaining({ allocatedQty: 40, allocationRequestId: requestId }),
            ],
          }),
        ],
      }),
    ]);
    expect(result[0]?.shelter.location).toMatchObject({ latitude: 6.9271, longitude: 79.8612 });
  });

  it("intersects optional status and severity filters with actionable states", async () => {
    const prisma = client();
    const repository = new PrismaReliefReadRepository(prisma);

    await repository.listActionableRequests({
      districtId,
      status: ReliefRequestStatus.PARTIALLY_ALLOCATED,
      zoneSeverity: ZoneSeverity.HIGH,
    });
    expect(prisma.reliefRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          shelter: { districtId },
          status: { in: [ReliefRequestStatus.PARTIALLY_ALLOCATED] },
          targetZone: { severity: ZoneSeverity.HIGH },
        },
      }),
    );

    await repository.listActionableRequests({
      districtId,
      status: ReliefRequestStatus.ALLOCATED,
    });
    expect(prisma.reliefRequest.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: {
          shelter: { districtId },
          status: { in: [] },
        },
      }),
    );
  });

  it("returns null for a missing request and maps allocation history when present", async () => {
    const findUnique = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        ...requestRecord(),
        allocations: [
          {
            id: "73000000-0000-4000-8000-000000000001",
            createdAt: new Date("2026-09-25T11:00:00.000Z"),
            items: requestRecord().items[0]!.allocationItems,
          },
        ],
      });
    const prisma = client({
      reliefRequest: { findMany: vi.fn(async () => []), findUnique },
    });
    const repository = new PrismaReliefReadRepository(prisma);

    await expect(repository.findRequestById(requestId)).resolves.toBeNull();
    await expect(repository.findRequestById(requestId)).resolves.toEqual(
      expect.objectContaining({
        id: requestId,
        allocations: [
          expect.objectContaining({
            id: "73000000-0000-4000-8000-000000000001",
            items: [expect.objectContaining({ allocationRequestId: requestId })],
          }),
        ],
      }),
    );
    expect(findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: requestId } }));
  });

  it("reads stock, active partners, and available teams with district filters", async () => {
    const stock = [
      {
        districtId,
        supplyType: SupplyType.WATER,
        availableQty: 60,
        version: 2,
        syncedAt: new Date(),
      },
    ];
    const partners = [
      {
        id: "80000000-0000-4000-8000-000000000001",
        districtId,
        name: "Relief NGO",
        type: PartnerOrganisationType.NGO,
        active: true,
      },
    ];
    const teams = [
      {
        id: "90000000-0000-4000-8000-000000000001",
        districtId,
        name: "Team A",
        status: RescueTeamStatus.AVAILABLE,
      },
    ];
    const prisma = client({
      warehouseStock: { findMany: vi.fn(async () => stock) },
      partnerOrganisation: { findMany: vi.fn(async () => partners) },
      rescueTeam: { findMany: vi.fn(async () => teams) },
    });
    const repository = new PrismaReliefReadRepository(prisma);

    await expect(repository.listWarehouseStock(districtId, [SupplyType.WATER])).resolves.toBe(
      stock,
    );
    await expect(repository.listActivePartners(districtId)).resolves.toBe(partners);
    await expect(repository.listAvailableRescueTeams(districtId)).resolves.toBe(teams);

    expect(prisma.warehouseStock.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { districtId, supplyType: { in: [SupplyType.WATER] } },
      }),
    );
    expect(prisma.partnerOrganisation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { districtId, active: true } }),
    );
    expect(prisma.rescueTeam.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { districtId, status: RescueTeamStatus.AVAILABLE },
      }),
    );
  });
});

import {
  PartnerOrganisationType,
  ReliefRequestStatus,
  RescueTeamStatus,
  SupplyType,
  ZoneSeverity,
} from "@disaster/domain";
import { describe, expect, it, vi } from "vitest";

import type { ReliefReadError } from "./relief-read-errors.js";
import type {
  ReliefReadRepository,
  ReliefReadRequestDetailsRecord,
  ReliefReadRequestSummaryRecord,
} from "./relief-read-repository.js";
import { ReliefReadService } from "./relief-read-service.js";

const ids = {
  district: "00000000-0000-4000-8000-000000000001",
  otherDistrict: "00000000-0000-4000-8000-000000000002",
  officer: "10000000-0000-4000-8000-000000000001",
  requestA: "70000000-0000-4000-8000-000000000001",
  requestB: "70000000-0000-4000-8000-000000000002",
  requestC: "70000000-0000-4000-8000-000000000003",
  requestD: "70000000-0000-4000-8000-000000000004",
  requestItemWater: "71000000-0000-4000-8000-000000000001",
  requestItemMedical: "71000000-0000-4000-8000-000000000002",
} as const;

const actor = { officerId: ids.officer, districtId: ids.district } as const;

function summary(
  options: Partial<{
    id: string;
    status: ReliefReadRequestSummaryRecord["status"];
    severity: ReliefReadRequestSummaryRecord["targetZone"]["severity"];
    districtId: string;
    locationDistrictId: string;
    zoneDistrictId: string;
    occupancy: number;
    capacity: number;
    createdAt: string;
    requestedQty: number;
    allocatedQuantities: readonly number[];
  }> = {},
): ReliefReadRequestSummaryRecord {
  const requestId = options.id ?? ids.requestA;
  const districtId = options.districtId ?? ids.district;
  return {
    id: requestId,
    status: options.status ?? ReliefRequestStatus.AWAITING_ALLOCATION,
    priorityNote: "Urgent supplies",
    createdAt: new Date(options.createdAt ?? "2026-09-25T10:00:00.000Z"),
    version: 2,
    shelter: {
      id: "60000000-0000-4000-8000-000000000001",
      name: "Central Shelter",
      districtId,
      capacity: options.capacity ?? 200,
      currentOccupancy: options.occupancy ?? 100,
      location: {
        districtId: options.locationDistrictId ?? districtId,
        latitude: 6.9271,
        longitude: 79.8612,
        address: "Central Road",
      },
    },
    targetZone: {
      id: "30000000-0000-4000-8000-000000000001",
      name: "Flood Zone",
      districtId: options.zoneDistrictId ?? districtId,
      severity: options.severity ?? ZoneSeverity.CRITICAL,
    },
    items: [
      {
        id: ids.requestItemWater,
        supplyType: SupplyType.WATER,
        requestedQty: options.requestedQty ?? 100,
        allocationItems: (options.allocatedQuantities ?? []).map((allocatedQty) => ({
          requestItemId: ids.requestItemWater,
          supplyType: SupplyType.WATER,
          allocatedQty,
          allocationRequestId: requestId,
        })),
      },
    ],
  };
}

function details(options: Parameters<typeof summary>[0] = {}): ReliefReadRequestDetailsRecord {
  const base = summary(options);
  const medicalItem = {
    id: ids.requestItemMedical,
    supplyType: SupplyType.MEDICAL_KIT,
    requestedQty: 20,
    allocationItems: [
      {
        requestItemId: ids.requestItemMedical,
        supplyType: SupplyType.MEDICAL_KIT,
        allocatedQty: 8,
        allocationRequestId: base.id,
      },
    ],
  } as const;
  return {
    ...base,
    items: [...base.items, medicalItem],
    allocations: [
      {
        id: "73000000-0000-4000-8000-000000000001",
        createdAt: new Date("2026-09-25T11:00:00.000Z"),
        items: [
          {
            requestItemId: ids.requestItemWater,
            supplyType: SupplyType.WATER,
            allocatedQty: 40,
            allocationRequestId: base.id,
          },
          ...medicalItem.allocationItems,
        ],
      },
    ],
  };
}

function repository(overrides: Partial<ReliefReadRepository> = {}): ReliefReadRepository & {
  listActionableRequests: ReturnType<typeof vi.fn<ReliefReadRepository["listActionableRequests"]>>;
  findRequestById: ReturnType<typeof vi.fn<ReliefReadRepository["findRequestById"]>>;
  listWarehouseStock: ReturnType<typeof vi.fn<ReliefReadRepository["listWarehouseStock"]>>;
  listActivePartners: ReturnType<typeof vi.fn<ReliefReadRepository["listActivePartners"]>>;
  listAvailableRescueTeams: ReturnType<
    typeof vi.fn<ReliefReadRepository["listAvailableRescueTeams"]>
  >;
} {
  const defaults = {
    listActionableRequests: vi.fn<ReliefReadRepository["listActionableRequests"]>(async () => []),
    findRequestById: vi.fn<ReliefReadRepository["findRequestById"]>(async () => null),
    listWarehouseStock: vi.fn<ReliefReadRepository["listWarehouseStock"]>(async () => [
      {
        districtId: ids.district,
        supplyType: SupplyType.WATER,
        availableQty: 60,
        version: 3,
        syncedAt: new Date("2026-09-25T11:30:00.000Z"),
      },
      {
        districtId: ids.district,
        supplyType: SupplyType.MEDICAL_KIT,
        availableQty: 12,
        version: 4,
        syncedAt: new Date("2026-09-25T11:31:00.000Z"),
      },
    ]),
    listActivePartners: vi.fn<ReliefReadRepository["listActivePartners"]>(async () => [
      {
        id: "80000000-0000-4000-8000-000000000001",
        districtId: ids.district,
        name: "Active NGO",
        type: PartnerOrganisationType.NGO,
        active: true,
      },
      {
        id: "80000000-0000-4000-8000-000000000002",
        districtId: ids.district,
        name: "Inactive NGO",
        type: PartnerOrganisationType.NGO,
        active: false,
      },
      {
        id: "80000000-0000-4000-8000-000000000003",
        districtId: ids.otherDistrict,
        name: "Other District NGO",
        type: PartnerOrganisationType.NGO,
        active: true,
      },
    ]),
    listAvailableRescueTeams: vi.fn<ReliefReadRepository["listAvailableRescueTeams"]>(async () => [
      {
        id: "90000000-0000-4000-8000-000000000001",
        districtId: ids.district,
        name: "Available Team",
        status: RescueTeamStatus.AVAILABLE,
      },
      {
        id: "90000000-0000-4000-8000-000000000002",
        districtId: ids.district,
        name: "En Route Team",
        status: RescueTeamStatus.EN_ROUTE,
      },
      {
        id: "90000000-0000-4000-8000-000000000003",
        districtId: ids.district,
        name: "Unavailable Team",
        status: RescueTeamStatus.UNAVAILABLE,
      },
      {
        id: "90000000-0000-4000-8000-000000000004",
        districtId: ids.otherDistrict,
        name: "Other District Team",
        status: RescueTeamStatus.AVAILABLE,
      },
    ]),
  };
  return Object.assign(defaults, overrides);
}

describe("ranked relief request queue service", () => {
  it("returns only actionable own-district requests", async () => {
    const records = [
      summary({ id: ids.requestA, status: ReliefRequestStatus.AWAITING_ALLOCATION }),
      summary({ id: ids.requestB, status: ReliefRequestStatus.PARTIALLY_ALLOCATED }),
      summary({ id: ids.requestC, status: ReliefRequestStatus.AWAITING_RESUPPLY }),
      summary({ id: ids.requestD, status: ReliefRequestStatus.ALLOCATED }),
      summary({ id: "70000000-0000-4000-8000-000000000005", districtId: ids.otherDistrict }),
    ];
    const repo = repository({ listActionableRequests: vi.fn(async () => records) });

    const result = await new ReliefReadService(repo).listRankedRequests(actor, {});

    expect(result.map(({ status }) => status).sort()).toEqual(
      [
        ReliefRequestStatus.AWAITING_ALLOCATION,
        ReliefRequestStatus.PARTIALLY_ALLOCATED,
        ReliefRequestStatus.AWAITING_RESUPPLY,
      ].sort(),
    );
    expect(result).toHaveLength(3);
  });

  it("ranks severity from CRITICAL through LOW", async () => {
    const repo = repository({
      listActionableRequests: vi.fn(async () => [
        summary({ id: ids.requestD, severity: ZoneSeverity.LOW }),
        summary({ id: ids.requestC, severity: ZoneSeverity.MODERATE }),
        summary({ id: ids.requestB, severity: ZoneSeverity.HIGH }),
        summary({ id: ids.requestA, severity: ZoneSeverity.CRITICAL }),
      ]),
    });

    const result = await new ReliefReadService(repo).listRankedRequests(actor, {});

    expect(result.map(({ targetZone }) => targetZone.severity)).toEqual([
      ZoneSeverity.CRITICAL,
      ZoneSeverity.HIGH,
      ZoneSeverity.MODERATE,
      ZoneSeverity.LOW,
    ]);
  });

  it("uses occupancy, oldest request, and request ID as deterministic tie-breakers", async () => {
    const repo = repository({
      listActionableRequests: vi.fn(async () => [
        summary({ id: ids.requestD, occupancy: 100, capacity: 200, createdAt: "2026-09-24" }),
        summary({ id: ids.requestC, occupancy: 180, capacity: 200, createdAt: "2026-09-26" }),
        summary({ id: ids.requestB, occupancy: 100, capacity: 200, createdAt: "2026-09-23" }),
        summary({ id: ids.requestA, occupancy: 100, capacity: 200, createdAt: "2026-09-23" }),
      ]),
    });

    const result = await new ReliefReadService(repo).listRankedRequests(actor, {});

    expect(result.map(({ requestId }) => requestId)).toEqual([
      ids.requestC,
      ids.requestA,
      ids.requestB,
      ids.requestD,
    ]);
  });

  it("uses cumulative allocations and preserves a fully allocated line as zero outstanding", async () => {
    const request = summary({ allocatedQuantities: [25, 35] });
    const fullyAllocatedItem = {
      ...request.items[0]!,
      id: ids.requestItemMedical,
      supplyType: SupplyType.MEDICAL_KIT,
      requestedQty: 20,
      allocationItems: [
        {
          requestItemId: ids.requestItemMedical,
          supplyType: SupplyType.MEDICAL_KIT,
          allocatedQty: 20,
          allocationRequestId: request.id,
        },
      ],
    } as const;
    const repo = repository({
      listActionableRequests: vi.fn(async () => [
        { ...request, items: [...request.items, fullyAllocatedItem] },
      ]),
    });

    const [result] = await new ReliefReadService(repo).listRankedRequests(actor, {});

    expect(result?.outstandingSupplies).toEqual([
      { supplyType: SupplyType.WATER, outstandingQty: 40 },
      { supplyType: SupplyType.MEDICAL_KIT, outstandingQty: 0 },
    ]);
  });

  it("fails safely for impossible persisted over-allocation", async () => {
    const repo = repository({
      listActionableRequests: vi.fn(async () => [summary({ allocatedQuantities: [70, 31] })]),
    });

    await expect(new ReliefReadService(repo).listRankedRequests(actor, {})).rejects.toMatchObject({
      code: "RELIEF_DATA_INTEGRITY_ERROR",
    });
  });

  it("returns a valid empty queue", async () => {
    await expect(
      new ReliefReadService(repository()).listRankedRequests(actor, {}),
    ).resolves.toEqual([]);
  });

  it("applies frozen filters without bypassing ranking", async () => {
    const repo = repository({
      listActionableRequests: vi.fn(async () => [
        summary({ id: ids.requestB, severity: ZoneSeverity.HIGH }),
        summary({ id: ids.requestA, severity: ZoneSeverity.CRITICAL }),
        summary({
          id: ids.requestC,
          severity: ZoneSeverity.CRITICAL,
          status: ReliefRequestStatus.PARTIALLY_ALLOCATED,
        }),
      ]),
    });
    const service = new ReliefReadService(repo);

    const result = await service.listRankedRequests(actor, {
      status: ReliefRequestStatus.AWAITING_ALLOCATION,
      zoneSeverity: ZoneSeverity.CRITICAL,
    });

    expect(result.map(({ requestId }) => requestId)).toEqual([ids.requestA]);
    expect(repo.listActionableRequests).toHaveBeenCalledWith({
      districtId: ids.district,
      status: ReliefRequestStatus.AWAITING_ALLOCATION,
      zoneSeverity: ZoneSeverity.CRITICAL,
    });
  });

  it("rejects a cross-district aggregate relationship without exposing it", async () => {
    const repo = repository({
      listActionableRequests: vi.fn(async () => [summary({ zoneDistrictId: ids.otherDistrict })]),
    });

    await expect(new ReliefReadService(repo).listRankedRequests(actor, {})).rejects.toMatchObject({
      code: "RELIEF_DATA_INTEGRITY_ERROR",
    });
  });

  it("maps repository failures to a safe dependency error", async () => {
    const repo = repository({
      listActionableRequests: vi.fn(async () => {
        throw new Error("database credentials");
      }),
    });

    await expect(new ReliefReadService(repo).listRankedRequests(actor, {})).rejects.toEqual(
      expect.objectContaining<Partial<ReliefReadError>>({ code: "RELIEF_READ_UNAVAILABLE" }),
    );
  });
});

describe("relief request details service", () => {
  it("returns the complete own-district read model with cumulative totals and filtered candidates", async () => {
    const request = details({ allocatedQuantities: [15, 25] });
    const repo = repository({ findRequestById: vi.fn(async () => request) });

    const result = await new ReliefReadService(repo).getRequestDetails(actor, request.id);

    expect(result).toMatchObject({
      requestId: request.id,
      requestVersion: 2,
      status: ReliefRequestStatus.AWAITING_ALLOCATION,
      shelter: {
        name: "Central Shelter",
        capacity: 200,
        currentOccupancy: 100,
        occupancyRate: 0.5,
        location: { latitude: 6.9271, longitude: 79.8612, address: "Central Road" },
      },
      targetZone: { name: "Flood Zone", severity: ZoneSeverity.CRITICAL },
    });
    expect(result.items).toEqual([
      expect.objectContaining({
        supplyType: SupplyType.WATER,
        requestedQty: 100,
        previouslyAllocatedQty: 40,
        outstandingQty: 60,
        warehouseStock: {
          availableQty: 60,
          version: 3,
          syncedAt: "2026-09-25T11:30:00.000Z",
        },
      }),
      expect.objectContaining({
        supplyType: SupplyType.MEDICAL_KIT,
        requestedQty: 20,
        previouslyAllocatedQty: 8,
        outstandingQty: 12,
      }),
    ]);
    expect(result.previousAllocations).toEqual([
      expect.objectContaining({
        allocationId: "73000000-0000-4000-8000-000000000001",
        items: expect.arrayContaining([
          expect.objectContaining({ supplyType: SupplyType.WATER, allocatedQty: 40 }),
          expect.objectContaining({ supplyType: SupplyType.MEDICAL_KIT, allocatedQty: 8 }),
        ]),
      }),
    ]);
    expect(result.eligiblePartners.map(({ name }) => name)).toEqual(["Active NGO"]);
    expect(result.availableRescueTeams.map(({ name }) => name)).toEqual(["Available Team"]);
  });

  it("does not query or expose rescue teams for a non-critical request", async () => {
    const request = details({ severity: ZoneSeverity.HIGH });
    const repo = repository({ findRequestById: vi.fn(async () => request) });

    const result = await new ReliefReadService(repo).getRequestDetails(actor, request.id);

    expect(result.availableRescueTeams).toEqual([]);
    expect(repo.listAvailableRescueTeams).not.toHaveBeenCalled();
  });

  it.each([
    ["missing", null],
    ["another district", details({ districtId: ids.otherDistrict })],
  ])("returns not found for %s request", async (_label, request) => {
    const repo = repository({ findRequestById: vi.fn(async () => request) });

    await expect(
      new ReliefReadService(repo).getRequestDetails(actor, ids.requestA),
    ).rejects.toMatchObject({
      code: "RELIEF_REQUEST_NOT_FOUND",
    });
  });

  it.each([
    details({ zoneDistrictId: ids.otherDistrict }),
    details({ locationDistrictId: ids.otherDistrict }),
  ])("rejects an inconsistent request/shelter/zone aggregate", async (request) => {
    const repo = repository({ findRequestById: vi.fn(async () => request) });

    await expect(
      new ReliefReadService(repo).getRequestDetails(actor, request.id),
    ).rejects.toMatchObject({
      code: "RELIEF_DATA_INTEGRITY_ERROR",
    });
  });

  it("fails explicitly when a required stock row is missing", async () => {
    const request = details();
    const repo = repository({
      findRequestById: vi.fn(async () => request),
      listWarehouseStock: vi.fn(async () => [
        {
          districtId: ids.district,
          supplyType: SupplyType.WATER,
          availableQty: 60,
          version: 3,
          syncedAt: new Date(),
        },
      ]),
    });

    await expect(
      new ReliefReadService(repo).getRequestDetails(actor, request.id),
    ).rejects.toMatchObject({
      code: "STOCK_LEDGER_UNAVAILABLE",
    });
  });

  it("maps a details repository failure without leaking its cause", async () => {
    const repo = repository({
      findRequestById: vi.fn(async () => {
        throw new Error("postgres host");
      }),
    });

    await expect(
      new ReliefReadService(repo).getRequestDetails(actor, ids.requestA),
    ).rejects.toMatchObject({
      code: "RELIEF_READ_UNAVAILABLE",
      message: "Relief request data is temporarily unavailable.",
    });
  });

  it("keeps an ALLOCATED request readable as historical details", async () => {
    const base = details({
      status: ReliefRequestStatus.ALLOCATED,
      allocatedQuantities: [100],
    });
    const request = {
      ...base,
      items: base.items.map((item) =>
        item.id === ids.requestItemMedical
          ? {
              ...item,
              allocationItems: item.allocationItems.map((allocationItem) => ({
                ...allocationItem,
                allocatedQty: 20,
              })),
            }
          : item,
      ),
    };
    const repo = repository({ findRequestById: vi.fn(async () => request) });

    const result = await new ReliefReadService(repo).getRequestDetails(actor, request.id);

    expect(result.status).toBe(ReliefRequestStatus.ALLOCATED);
    expect(result.previousAllocations).toHaveLength(1);
  });

  it("rejects allocation history linked to a different request", async () => {
    const request = details();
    const invalid = {
      ...request,
      allocations: [
        {
          ...request.allocations[0]!,
          items: [
            {
              ...request.allocations[0]!.items[0]!,
              allocationRequestId: ids.requestB,
            },
          ],
        },
      ],
    };
    const repo = repository({ findRequestById: vi.fn(async () => invalid) });

    await expect(
      new ReliefReadService(repo).getRequestDetails(actor, request.id),
    ).rejects.toMatchObject({
      code: "RELIEF_DATA_INTEGRITY_ERROR",
    });
  });

  it("performs read-only composition without changing shelter occupancy or capacity", async () => {
    const request = details();
    const before = {
      capacity: request.shelter.capacity,
      currentOccupancy: request.shelter.currentOccupancy,
    };
    const repo = repository({ findRequestById: vi.fn(async () => request) });

    await new ReliefReadService(repo).getRequestDetails(actor, request.id);

    expect(request.shelter).toMatchObject(before);
    expect(Object.keys(repo)).not.toContain("updateShelter");
  });
});

import type { PrismaClient } from "@prisma/client";
import { ReliefRequestStatus, RescueTeamStatus, SupplyType, ZoneSeverity } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { PrismaReliefAllocationTransaction } from "./prisma-relief-allocation-transaction.js";
import type { PreparedReliefAllocationCommand } from "./relief-command-repository.js";

const ids = {
  district: "00000000-0000-4000-8000-000000000001",
  otherDistrict: "00000000-0000-4000-8000-000000000002",
  officer: "10000000-0000-4000-8000-000000000001",
  key: "20000000-0000-4000-8000-000000000001",
  request: "70000000-0000-4000-8000-000000000001",
  waterItem: "71000000-0000-4000-8000-000000000001",
  medicalItem: "71000000-0000-4000-8000-000000000002",
  partner: "80000000-0000-4000-8000-000000000001",
  team: "90000000-0000-4000-8000-000000000001",
  shelterLocation: "a0000000-0000-4000-8000-000000000001",
} as const;

function requestAggregate(overrides: Record<string, unknown> = {}) {
  return {
    status: ReliefRequestStatus.AWAITING_ALLOCATION,
    version: 1,
    shelter: {
      districtId: ids.district,
      locationId: ids.shelterLocation,
      location: { districtId: ids.district },
    },
    targetZone: { districtId: ids.district, severity: ZoneSeverity.CRITICAL },
    items: [
      {
        id: ids.waterItem,
        supplyType: SupplyType.WATER,
        requestedQty: 10,
        allocationItems: [] as { allocatedQty: number }[],
      },
    ],
    ...overrides,
  };
}

function prepared(overrides: Partial<PreparedReliefAllocationCommand> = {}) {
  return {
    officerId: ids.officer,
    districtId: ids.district,
    requestId: ids.request,
    idempotencyKey: ids.key,
    canonicalIntent: "intent",
    command: {
      requestVersion: 1,
      items: [{ requestItemId: ids.waterItem, allocateQty: 10 }],
      shortages: [],
    },
    ...overrides,
  } satisfies PreparedReliefAllocationCommand;
}

function fakeDatabase(request = requestAggregate()) {
  const transaction = {
    resourceAllocation: {
      findUnique: vi.fn(async () => null),
      create: vi.fn(async () => ({ id: "allocation" })),
    },
    reliefRequest: {
      findUnique: vi.fn(async () => request),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    partnerOrganisation: {
      findMany: vi.fn(async () => [{ id: ids.partner, districtId: ids.district, active: true }]),
    },
    partnerResupplyRequest: {
      findFirst: vi.fn(async () => null),
      create: vi.fn(async () => ({ id: "resupply" })),
    },
    rescueTeam: {
      findUnique: vi.fn(async () => ({
        districtId: ids.district,
        status: RescueTeamStatus.AVAILABLE,
      })),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    warehouseStock: { updateMany: vi.fn(async () => ({ count: 1 })) },
    allocationItem: { create: vi.fn(async () => ({ id: "item" })) },
    distributionLog: { create: vi.fn(async () => ({ id: "log" })) },
    transportDispatch: { create: vi.fn(async () => ({ id: "dispatch" })) },
  };
  const client = {
    $transaction: vi.fn(async (operation: (tx: typeof transaction) => Promise<unknown>) =>
      operation(transaction),
    ),
  } as unknown as PrismaClient;
  let sequence = 0;
  const port = new PrismaReliefAllocationTransaction(client, {
    now: () => new Date("2026-09-25T12:00:00.000Z"),
    createId: () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`,
  });
  return { client, transaction, port };
}

describe("atomic relief allocation transaction", () => {
  it("commits an exact-boundary allocation with one item, log, and derived ALLOCATED status", async () => {
    const { port, transaction } = fakeDatabase();

    await expect(port.execute(prepared())).resolves.toEqual({ kind: "COMMITTED" });

    expect(transaction.warehouseStock.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ availableQty: { gte: 10 } }),
        data: { availableQty: { decrement: 10 }, version: { increment: 1 } },
      }),
    );
    expect(transaction.allocationItem.create).toHaveBeenCalledOnce();
    expect(transaction.distributionLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          quantity: 10,
          createdAt: new Date("2026-09-25T12:00:00.000Z"),
        }),
      }),
    );
    expect(transaction.resourceAllocation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ createdAt: new Date("2026-09-25T12:00:00.000Z") }),
      }),
    );
    expect(transaction.partnerResupplyRequest.create).not.toHaveBeenCalled();
    expect(transaction.reliefRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: ReliefRequestStatus.ALLOCATED, version: { increment: 1 } },
      }),
    );
  });

  it("fully allocates multiple items with exactly one log for each positive item", async () => {
    const request = requestAggregate({
      items: [
        {
          id: ids.waterItem,
          supplyType: SupplyType.WATER,
          requestedQty: 10,
          allocationItems: [],
        },
        {
          id: ids.medicalItem,
          supplyType: SupplyType.MEDICAL_KIT,
          requestedQty: 5,
          allocationItems: [],
        },
      ],
    });
    const { port, transaction } = fakeDatabase(request);

    await port.execute(
      prepared({
        command: {
          requestVersion: 1,
          items: [
            { requestItemId: ids.waterItem, allocateQty: 10 },
            { requestItemId: ids.medicalItem, allocateQty: 5 },
          ],
          shortages: [],
        },
      }),
    );

    expect(transaction.warehouseStock.updateMany).toHaveBeenCalledTimes(2);
    expect(transaction.allocationItem.create).toHaveBeenCalledTimes(2);
    expect(transaction.distributionLog.create).toHaveBeenCalledTimes(2);
    expect(transaction.reliefRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: ReliefRequestStatus.ALLOCATED, version: { increment: 1 } },
      }),
    );
  });

  it("creates positive items/logs only and one server-calculated resupply per shortage", async () => {
    const request = requestAggregate({
      items: [
        {
          id: ids.waterItem,
          supplyType: SupplyType.WATER,
          requestedQty: 10,
          allocationItems: [],
        },
        {
          id: ids.medicalItem,
          supplyType: SupplyType.MEDICAL_KIT,
          requestedQty: 5,
          allocationItems: [],
        },
      ],
    });
    const { port, transaction } = fakeDatabase(request);
    const command = prepared({
      command: {
        requestVersion: 1,
        items: [
          { requestItemId: ids.waterItem, allocateQty: 10 },
          { requestItemId: ids.medicalItem, allocateQty: 0 },
        ],
        shortages: [{ requestItemId: ids.medicalItem, partnerOrganisationId: ids.partner }],
      },
    });

    await port.execute(command);

    expect(transaction.allocationItem.create).toHaveBeenCalledOnce();
    expect(transaction.distributionLog.create).toHaveBeenCalledOnce();
    expect(transaction.partnerResupplyRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          requestedQty: 5,
          status: "REQUESTED",
          createdAt: new Date("2026-09-25T12:00:00.000Z"),
        }),
      }),
    );
    expect(transaction.reliefRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: ReliefRequestStatus.PARTIALLY_ALLOCATED, version: { increment: 1 } },
      }),
    );
  });

  it("persists an all-zero resupply-only allocation anchor without zero items or logs", async () => {
    const { port, transaction } = fakeDatabase();

    await port.execute(
      prepared({
        command: {
          requestVersion: 1,
          items: [{ requestItemId: ids.waterItem, allocateQty: 0 }],
          shortages: [{ requestItemId: ids.waterItem, partnerOrganisationId: ids.partner }],
        },
      }),
    );

    expect(transaction.resourceAllocation.create).toHaveBeenCalledOnce();
    expect(transaction.warehouseStock.updateMany).not.toHaveBeenCalled();
    expect(transaction.allocationItem.create).not.toHaveBeenCalled();
    expect(transaction.distributionLog.create).not.toHaveBeenCalled();
    expect(transaction.partnerResupplyRequest.create).toHaveBeenCalledOnce();
    expect(transaction.reliefRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: ReliefRequestStatus.AWAITING_RESUPPLY, version: { increment: 1 } },
      }),
    );
  });

  it.each([
    [
      "already allocated request",
      requestAggregate({ status: ReliefRequestStatus.ALLOCATED }),
      prepared(),
      "REQUEST_ALREADY_ALLOCATED",
    ],
    ["stale request version", requestAggregate({ version: 2 }), prepared(), "REQUEST_CHANGED"],
    [
      "quantity above outstanding",
      requestAggregate(),
      prepared({
        command: {
          requestVersion: 1,
          items: [{ requestItemId: ids.waterItem, allocateQty: 11 }],
          shortages: [],
        },
      }),
      "REQUEST_CHANGED",
    ],
  ] as const)("rejects %s before business writes", async (_label, request, command, code) => {
    const { port, transaction } = fakeDatabase(request);

    await expect(port.execute(command)).rejects.toMatchObject({ code });
    expect(transaction.resourceAllocation.create).not.toHaveBeenCalled();
    expect(transaction.reliefRequest.updateMany).not.toHaveBeenCalled();
  });

  it("rejects changed stock when the conditional decrement affects no row", async () => {
    const { port, transaction } = fakeDatabase();
    transaction.warehouseStock.updateMany.mockResolvedValue({ count: 0 });

    await expect(port.execute(prepared())).rejects.toMatchObject({ code: "STOCK_CHANGED" });
    expect(transaction.resourceAllocation.create).not.toHaveBeenCalled();
  });

  it.each([
    ["missing", []],
    ["inactive", [{ id: ids.partner, districtId: ids.district, active: false }]],
    ["cross-district", [{ id: ids.partner, districtId: ids.otherDistrict, active: true }]],
  ] as const)("rejects a %s shortage partner", async (_label, partners) => {
    const { port, transaction } = fakeDatabase();
    transaction.partnerOrganisation.findMany.mockResolvedValue([...partners]);

    await expect(
      port.execute(
        prepared({
          command: {
            requestVersion: 1,
            items: [{ requestItemId: ids.waterItem, allocateQty: 5 }],
            shortages: [{ requestItemId: ids.waterItem, partnerOrganisationId: ids.partner }],
          },
        }),
      ),
    ).rejects.toMatchObject({ code: "PARTNER_REQUIRED" });
  });

  it("maps a duplicate active resupply to REQUEST_CHANGED", async () => {
    const { port, transaction } = fakeDatabase();
    transaction.partnerResupplyRequest.findFirst.mockResolvedValue({ id: "existing" });

    await expect(
      port.execute(
        prepared({
          command: {
            requestVersion: 1,
            items: [{ requestItemId: ids.waterItem, allocateQty: 5 }],
            shortages: [{ requestItemId: ids.waterItem, partnerOrganisationId: ids.partner }],
          },
        }),
      ),
    ).rejects.toMatchObject({ code: "REQUEST_CHANGED" });
  });

  it("requires a partner selection for every server-calculated shortage", async () => {
    const { port } = fakeDatabase();

    await expect(
      port.execute(
        prepared({
          command: {
            requestVersion: 1,
            items: [{ requestItemId: ids.waterItem, allocateQty: 5 }],
            shortages: [],
          },
        }),
      ),
    ).rejects.toMatchObject({ code: "PARTNER_REQUIRED" });
  });

  it("uses cumulative allocation totals when deriving a later resupply-only status", async () => {
    const request = requestAggregate({
      status: ReliefRequestStatus.PARTIALLY_ALLOCATED,
      items: [
        {
          id: ids.waterItem,
          supplyType: SupplyType.WATER,
          requestedQty: 10,
          allocationItems: [{ allocatedQty: 5 }],
        },
      ],
    });
    const { port, transaction } = fakeDatabase(request);

    await port.execute(
      prepared({
        command: {
          requestVersion: 1,
          items: [{ requestItemId: ids.waterItem, allocateQty: 0 }],
          shortages: [{ requestItemId: ids.waterItem, partnerOrganisationId: ids.partner }],
        },
      }),
    );

    expect(transaction.reliefRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: ReliefRequestStatus.PARTIALLY_ALLOCATED, version: { increment: 1 } },
      }),
    );
  });

  it("dispatches a same-district AVAILABLE team and shares the command timestamp", async () => {
    const { port, transaction } = fakeDatabase();

    await port.execute(
      prepared({
        command: {
          requestVersion: 1,
          items: [{ requestItemId: ids.waterItem, allocateQty: 10 }],
          shortages: [],
          rescueTeamId: ids.team,
        },
      }),
    );

    expect(transaction.rescueTeam.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: RescueTeamStatus.AVAILABLE }),
        data: { status: RescueTeamStatus.EN_ROUTE, version: { increment: 1 } },
      }),
    );
    expect(transaction.transportDispatch.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          destinationLocationId: ids.shelterLocation,
          dispatchedAt: new Date("2026-09-25T12:00:00.000Z"),
        }),
      }),
    );
  });

  it.each([
    [
      "non-critical zone",
      requestAggregate({ targetZone: { districtId: ids.district, severity: ZoneSeverity.HIGH } }),
      { districtId: ids.district, status: RescueTeamStatus.AVAILABLE },
    ],
    [
      "EN_ROUTE team",
      requestAggregate(),
      { districtId: ids.district, status: RescueTeamStatus.EN_ROUTE },
    ],
    [
      "UNAVAILABLE team",
      requestAggregate(),
      { districtId: ids.district, status: RescueTeamStatus.UNAVAILABLE },
    ],
    [
      "cross-district team",
      requestAggregate(),
      { districtId: ids.otherDistrict, status: RescueTeamStatus.AVAILABLE },
    ],
  ] as const)("rejects dispatch for a %s", async (_label, request, team) => {
    const { port, transaction } = fakeDatabase(request);
    transaction.rescueTeam.findUnique.mockResolvedValue(team);

    await expect(
      port.execute(
        prepared({
          command: {
            requestVersion: 1,
            items: [{ requestItemId: ids.waterItem, allocateQty: 10 }],
            shortages: [],
            rescueTeamId: ids.team,
          },
        }),
      ),
    ).rejects.toMatchObject({ code: "TEAM_UNAVAILABLE" });
  });

  it("rejects a rescue team on an all-zero resupply-only command", async () => {
    const { port, transaction } = fakeDatabase();

    await expect(
      port.execute(
        prepared({
          command: {
            requestVersion: 1,
            items: [{ requestItemId: ids.waterItem, allocateQty: 0 }],
            shortages: [{ requestItemId: ids.waterItem, partnerOrganisationId: ids.partner }],
            rescueTeamId: ids.team,
          },
        }),
      ),
    ).rejects.toMatchObject({ code: "TEAM_UNAVAILABLE" });
    expect(transaction.rescueTeam.updateMany).not.toHaveBeenCalled();
  });

  it("returns an idempotency-race marker when the key appears inside the transaction", async () => {
    const { port, transaction } = fakeDatabase();
    transaction.resourceAllocation.findUnique.mockResolvedValue({ id: "existing" });

    await expect(port.execute(prepared())).resolves.toEqual({ kind: "IDEMPOTENCY_RACE" });
    expect(transaction.reliefRequest.findUnique).not.toHaveBeenCalled();
  });

  it("retries P2034 twice and never retries typed business conflicts", async () => {
    const { port, client, transaction } = fakeDatabase();
    vi.mocked(client.$transaction)
      .mockRejectedValueOnce({ code: "P2034" })
      .mockRejectedValueOnce({ code: "P2034" });

    await expect(port.execute(prepared())).resolves.toEqual({ kind: "COMMITTED" });
    expect(client.$transaction).toHaveBeenCalledTimes(3);

    transaction.warehouseStock.updateMany.mockResolvedValue({ count: 0 });
    await expect(port.execute(prepared())).rejects.toMatchObject({ code: "STOCK_CHANGED" });
    expect(client.$transaction).toHaveBeenCalledTimes(4);
  });
});

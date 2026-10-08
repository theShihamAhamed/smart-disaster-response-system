import {
  PartnerOrganisationType,
  PrismaClient,
  ReliefRequestStatus,
  RescueTeamStatus,
  SupplyType,
  UserRole,
  ZoneSeverity,
} from "@prisma/client";
import type { Prisma } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { PrismaReliefAllocationTransaction } from "./prisma-relief-allocation-transaction.js";
import { PrismaReliefAllocationCommandRepository } from "./prisma-relief-command-repository.js";
import type { PreparedReliefAllocationCommand } from "./relief-command-repository.js";
import { ReliefAllocationCommandService } from "./relief-command-service.js";

function isIsolatedPostgres(urlValue: string | undefined): boolean {
  if (!urlValue) return false;
  try {
    const url = new URL(urlValue);
    const localHost = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    return localHost && url.pathname.toLowerCase().includes("test");
  } catch {
    return false;
  }
}

const integrationRequested = process.env.RUN_RELIEF_DB_INTEGRATION_TESTS === "true";
const isolatedDatabase = isIsolatedPostgres(process.env.DATABASE_URL);
if (integrationRequested && !isolatedDatabase) {
  throw new Error(
    "Relief database integration tests require a localhost PostgreSQL database whose name contains 'test'.",
  );
}

const describeIntegration = integrationRequested && isolatedDatabase ? describe : describe.skip;
let prisma: PrismaClient;

const ids = {
  district: "e0000000-0000-4000-8000-000000000001",
  officer: "e1000000-0000-4000-8000-000000000001",
  shelterLocation: "e2000000-0000-4000-8000-000000000001",
  teamLocation: "e2000000-0000-4000-8000-000000000002",
  zone: "e3000000-0000-4000-8000-000000000001",
  shelter: "e4000000-0000-4000-8000-000000000001",
  stock: "e5000000-0000-4000-8000-000000000001",
  requestA: "e6000000-0000-4000-8000-000000000001",
  requestB: "e6000000-0000-4000-8000-000000000002",
  requestC: "e6000000-0000-4000-8000-000000000003",
  itemA: "e7000000-0000-4000-8000-000000000001",
  itemB: "e7000000-0000-4000-8000-000000000002",
  itemC: "e7000000-0000-4000-8000-000000000003",
  partner: "e8000000-0000-4000-8000-000000000001",
  team: "e9000000-0000-4000-8000-000000000001",
  keyA: "ea000000-0000-4000-8000-000000000001",
  keyB: "ea000000-0000-4000-8000-000000000002",
  sharedKey: "ea000000-0000-4000-8000-000000000003",
} as const;

async function cleanup(): Promise<void> {
  await prisma.transportDispatch.deleteMany({
    where: { allocation: { requestId: { in: [ids.requestA, ids.requestB, ids.requestC] } } },
  });
  await prisma.distributionLog.deleteMany({
    where: { allocation: { requestId: { in: [ids.requestA, ids.requestB, ids.requestC] } } },
  });
  await prisma.allocationItem.deleteMany({
    where: { allocation: { requestId: { in: [ids.requestA, ids.requestB, ids.requestC] } } },
  });
  await prisma.partnerResupplyRequest.deleteMany({
    where: { reliefRequestId: { in: [ids.requestA, ids.requestB, ids.requestC] } },
  });
  await prisma.resourceAllocation.deleteMany({
    where: { requestId: { in: [ids.requestA, ids.requestB, ids.requestC] } },
  });
  await prisma.reliefRequestItem.deleteMany({
    where: { id: { in: [ids.itemA, ids.itemB, ids.itemC] } },
  });
  await prisma.reliefRequest.deleteMany({
    where: { id: { in: [ids.requestA, ids.requestB, ids.requestC] } },
  });
  await prisma.warehouseStock.deleteMany({ where: { id: ids.stock } });
  await prisma.partnerOrganisation.deleteMany({ where: { id: ids.partner } });
  await prisma.rescueTeam.deleteMany({ where: { id: ids.team } });
  await prisma.shelter.deleteMany({ where: { id: ids.shelter } });
  await prisma.targetZone.deleteMany({ where: { id: ids.zone } });
  await prisma.location.deleteMany({
    where: { id: { in: [ids.shelterLocation, ids.teamLocation] } },
  });
  await prisma.districtOfficer.deleteMany({ where: { userId: ids.officer } });
  await prisma.user.deleteMany({ where: { id: ids.officer } });
}

async function seedFixture(): Promise<void> {
  const createdAt = new Date("2026-09-25T10:00:00.000Z");
  await prisma.user.create({
    data: {
      id: ids.officer,
      name: "Transaction Integration Officer",
      contactNo: "+94770000888",
      role: UserRole.DISTRICT_OFFICER,
      districtOfficer: { create: { districtId: ids.district } },
    },
  });
  await prisma.location.createMany({
    data: [
      {
        id: ids.shelterLocation,
        latitude: 6.9271,
        longitude: 79.8612,
        districtId: ids.district,
        address: "Transaction shelter",
        source: "MANUAL",
      },
      {
        id: ids.teamLocation,
        latitude: 6.93,
        longitude: 79.87,
        districtId: ids.district,
        address: "Transaction team base",
        source: "GPS",
      },
    ],
  });
  await prisma.targetZone.create({
    data: {
      id: ids.zone,
      name: "Transaction Critical Zone",
      districtId: ids.district,
      severity: ZoneSeverity.CRITICAL,
      geometryRef: "integration:transaction-zone",
    },
  });
  await prisma.shelter.create({
    data: {
      id: ids.shelter,
      name: "Transaction Shelter",
      districtId: ids.district,
      locationId: ids.shelterLocation,
      capacity: 250,
      currentOccupancy: 175,
    },
  });
  await prisma.reliefRequest.createMany({
    data: [ids.requestA, ids.requestB, ids.requestC].map((id) => ({
      id,
      shelterId: ids.shelter,
      targetZoneId: ids.zone,
      status: ReliefRequestStatus.AWAITING_ALLOCATION,
      priorityNote: "Transaction integration request",
      createdAt,
      version: 1,
    })),
  });
  await prisma.reliefRequestItem.createMany({
    data: [
      { id: ids.itemA, requestId: ids.requestA, supplyType: SupplyType.WATER, requestedQty: 10 },
      { id: ids.itemB, requestId: ids.requestB, supplyType: SupplyType.WATER, requestedQty: 10 },
      { id: ids.itemC, requestId: ids.requestC, supplyType: SupplyType.WATER, requestedQty: 10 },
    ],
  });
  await prisma.warehouseStock.create({
    data: {
      id: ids.stock,
      districtId: ids.district,
      supplyType: SupplyType.WATER,
      availableQty: 10,
      version: 1,
      syncedAt: createdAt,
    },
  });
  await prisma.partnerOrganisation.create({
    data: {
      id: ids.partner,
      districtId: ids.district,
      name: "Transaction NGO",
      type: PartnerOrganisationType.NGO,
      active: true,
    },
  });
  await prisma.rescueTeam.create({
    data: {
      id: ids.team,
      districtId: ids.district,
      name: "Transaction Team",
      status: RescueTeamStatus.AVAILABLE,
      locationId: ids.teamLocation,
      version: 1,
    },
  });
}

function command(
  requestId: string,
  requestItemId: string,
  idempotencyKey: string,
  allocateQty = 10,
  rescueTeamId?: string,
): PreparedReliefAllocationCommand {
  const shortageQty = 10 - allocateQty;
  return {
    officerId: ids.officer,
    districtId: ids.district,
    requestId,
    idempotencyKey,
    canonicalIntent: "integration intent",
    command: {
      requestVersion: 1,
      items: [{ requestItemId, allocateQty }],
      shortages: shortageQty > 0 ? [{ requestItemId, partnerOrganisationId: ids.partner }] : [],
      ...(rescueTeamId ? { rescueTeamId } : {}),
    },
  };
}

function errorCodes(results: readonly PromiseSettledResult<unknown>[]): string[] {
  return results
    .filter((result): result is PromiseRejectedResult => result.status === "rejected")
    .map((result) =>
      typeof result.reason === "object" && result.reason && "code" in result.reason
        ? String(result.reason.code)
        : "UNKNOWN",
    );
}

describeIntegration("atomic relief allocation against isolated PostgreSQL", () => {
  beforeAll(async () => {
    prisma = new PrismaClient();
    await cleanup();
  });

  beforeEach(async () => {
    await cleanup();
    await seedFixture();
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  it("keeps competing stock nonnegative and preserves shelter occupancy/capacity", async () => {
    const port = new PrismaReliefAllocationTransaction(prisma);
    const shelterBefore = await prisma.shelter.findUniqueOrThrow({ where: { id: ids.shelter } });

    const results = await Promise.allSettled([
      port.execute(command(ids.requestA, ids.itemA, ids.keyA)),
      port.execute(command(ids.requestB, ids.itemB, ids.keyB)),
    ]);

    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(errorCodes(results)).toEqual(["STOCK_CHANGED"]);
    expect(
      (await prisma.warehouseStock.findUniqueOrThrow({ where: { id: ids.stock } })).availableQty,
    ).toBe(0);
    const shelterAfter = await prisma.shelter.findUniqueOrThrow({ where: { id: ids.shelter } });
    expect(shelterAfter.currentOccupancy).toBe(shelterBefore.currentOccupancy);
    expect(shelterAfter.capacity).toBe(shelterBefore.capacity);
  });

  it("allows only one command with the same request version", async () => {
    const port = new PrismaReliefAllocationTransaction(prisma);
    const results = await Promise.allSettled([
      port.execute(command(ids.requestA, ids.itemA, ids.keyA)),
      port.execute(command(ids.requestA, ids.itemA, ids.keyB)),
    ]);

    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(errorCodes(results)).toEqual(["REQUEST_CHANGED"]);
    expect(await prisma.resourceAllocation.count({ where: { requestId: ids.requestA } })).toBe(1);
    expect(await prisma.allocationItem.count({ where: { requestItemId: ids.itemA } })).toBe(1);
  });

  it("deducts once and returns one receipt for a concurrent same-key/same-intent retry", async () => {
    const repository = new PrismaReliefAllocationCommandRepository(prisma);
    const service = new ReliefAllocationCommandService(
      repository,
      new PrismaReliefAllocationTransaction(prisma),
    );
    const input = {
      actor: { officerId: ids.officer, districtId: ids.district },
      requestId: ids.requestA,
      idempotencyKey: ids.sharedKey,
      command: {
        requestVersion: 1,
        items: [{ requestItemId: ids.itemA, allocateQty: 10 }],
        shortages: [],
      },
    } as const;

    const results = await Promise.all([
      service.allocateReliefResources(input),
      service.allocateReliefResources(input),
    ]);

    expect(results.map(({ kind }) => kind).sort()).toEqual(["CREATED", "REPLAYED"]);
    expect(results[0].receipt).toEqual(results[1].receipt);
    expect(
      await prisma.resourceAllocation.count({ where: { idempotencyKey: ids.sharedKey } }),
    ).toBe(1);
    expect(
      (await prisma.warehouseStock.findUniqueOrThrow({ where: { id: ids.stock } })).availableQty,
    ).toBe(0);
  });

  it("persists a resupply-only command without zero allocation items or stock changes", async () => {
    const port = new PrismaReliefAllocationTransaction(prisma);

    await expect(port.execute(command(ids.requestC, ids.itemC, ids.keyA, 0))).resolves.toEqual({
      kind: "COMMITTED",
    });

    expect(await prisma.resourceAllocation.count({ where: { requestId: ids.requestC } })).toBe(1);
    expect(await prisma.allocationItem.count({ where: { requestItemId: ids.itemC } })).toBe(0);
    expect(
      await prisma.distributionLog.count({ where: { allocation: { requestId: ids.requestC } } }),
    ).toBe(0);
    expect(
      await prisma.partnerResupplyRequest.findMany({ where: { reliefRequestId: ids.requestC } }),
    ).toEqual([
      expect.objectContaining({
        partnerOrganisationId: ids.partner,
        supplyType: SupplyType.WATER,
        requestedQty: 10,
      }),
    ]);
    expect(
      await prisma.reliefRequest.findUniqueOrThrow({ where: { id: ids.requestC } }),
    ).toMatchObject({ status: ReliefRequestStatus.AWAITING_RESUPPLY, version: 2 });
    expect(
      (await prisma.warehouseStock.findUniqueOrThrow({ where: { id: ids.stock } })).availableQty,
    ).toBe(10);
  });

  it("prevents the same AVAILABLE rescue team from being dispatched twice", async () => {
    const port = new PrismaReliefAllocationTransaction(prisma);
    const results = await Promise.allSettled([
      port.execute(command(ids.requestA, ids.itemA, ids.keyA, 5, ids.team)),
      port.execute(command(ids.requestB, ids.itemB, ids.keyB, 5, ids.team)),
    ]);

    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(errorCodes(results)).toEqual(["TEAM_UNAVAILABLE"]);
    expect(await prisma.transportDispatch.count({ where: { rescueTeamId: ids.team } })).toBe(1);
    expect((await prisma.rescueTeam.findUniqueOrThrow({ where: { id: ids.team } })).status).toBe(
      RescueTeamStatus.EN_ROUTE,
    );
  });

  it("rolls back stock, allocation evidence, resupply, request, and team after a late failure", async () => {
    const failingClient = {
      $transaction: <T>(
        operation: (transaction: Prisma.TransactionClient) => Promise<T>,
        options?: { isolationLevel?: Prisma.TransactionIsolationLevel },
      ) =>
        prisma.$transaction(async (transaction) => {
          const wrapped = Object.create(transaction) as Prisma.TransactionClient;
          Object.defineProperty(wrapped, "transportDispatch", {
            value: {
              create: async () => {
                throw new Error("Injected late dispatch failure");
              },
            },
          });
          return operation(wrapped);
        }, options),
    } as unknown as PrismaClient;
    const port = new PrismaReliefAllocationTransaction(failingClient);

    await expect(
      port.execute(command(ids.requestA, ids.itemA, ids.keyA, 5, ids.team)),
    ).rejects.toMatchObject({ code: "ALLOCATION_DEPENDENCY_UNAVAILABLE" });

    expect(
      (await prisma.warehouseStock.findUniqueOrThrow({ where: { id: ids.stock } })).availableQty,
    ).toBe(10);
    expect(await prisma.resourceAllocation.count({ where: { requestId: ids.requestA } })).toBe(0);
    expect(await prisma.allocationItem.count({ where: { requestItemId: ids.itemA } })).toBe(0);
    expect(
      await prisma.distributionLog.count({ where: { allocation: { requestId: ids.requestA } } }),
    ).toBe(0);
    expect(
      await prisma.partnerResupplyRequest.count({ where: { reliefRequestId: ids.requestA } }),
    ).toBe(0);
    expect(await prisma.transportDispatch.count({ where: { rescueTeamId: ids.team } })).toBe(0);
    expect(
      await prisma.reliefRequest.findUniqueOrThrow({ where: { id: ids.requestA } }),
    ).toMatchObject({
      status: ReliefRequestStatus.AWAITING_ALLOCATION,
      version: 1,
    });
    expect((await prisma.rescueTeam.findUniqueOrThrow({ where: { id: ids.team } })).status).toBe(
      RescueTeamStatus.AVAILABLE,
    );
  });
});

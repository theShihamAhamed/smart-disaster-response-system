import type { PrismaClient } from "@prisma/client";
import {
  PartnerResupplyStatus,
  ReliefRequestStatus,
  RescueTeamStatus,
  SupplyType,
} from "@disaster/domain";
import { describe, expect, it, vi } from "vitest";

import { PrismaReliefAllocationCommandRepository } from "./prisma-relief-command-repository.js";

const officerId = "10000000-0000-4000-8000-000000000001";
const key = "20000000-0000-4000-8000-000000000001";
const requestId = "70000000-0000-4000-8000-000000000001";
const requestItemId = "71000000-0000-4000-8000-000000000001";
const createdAt = new Date("2026-09-25T12:00:00.000Z");

function client(allocation: unknown, resupplyRequests: readonly unknown[] = []) {
  return {
    resourceAllocation: { findUnique: vi.fn(async () => allocation) },
    partnerResupplyRequest: { findMany: vi.fn(async () => resupplyRequests) },
  } as unknown as PrismaClient;
}

function allocationRecord() {
  return {
    id: "30000000-0000-4000-8000-000000000001",
    officerId,
    idempotencyKey: key,
    requestId,
    notes: "Committed note",
    createdAt,
    request: {
      status: ReliefRequestStatus.PARTIALLY_ALLOCATED,
      items: [{ id: requestItemId, supplyType: SupplyType.WATER }],
    },
    items: [
      {
        id: "31000000-0000-4000-8000-000000000001",
        requestItemId,
        supplyType: SupplyType.WATER,
        allocatedQty: 40,
      },
    ],
    dispatch: {
      id: "33000000-0000-4000-8000-000000000001",
      rescueTeamId: "90000000-0000-4000-8000-000000000001",
      rescueTeam: { status: RescueTeamStatus.EN_ROUTE },
    },
  };
}

describe("Prisma relief allocation command repository", () => {
  it("uses the officer/key unique identity and avoids extra reads when absent", async () => {
    const prisma = client(null);
    const repository = new PrismaReliefAllocationCommandRepository(prisma);

    await expect(repository.findByOfficerAndIdempotencyKey(officerId, key)).resolves.toBeNull();
    expect(prisma.resourceAllocation.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { officerId_idempotencyKey: { officerId, idempotencyKey: key } },
      }),
    );
    expect(prisma.partnerResupplyRequest.findMany).not.toHaveBeenCalled();
  });

  it("maps persisted items, correlated resupplies, final state, and dispatch", async () => {
    const resupply = {
      id: "32000000-0000-4000-8000-000000000001",
      supplyType: SupplyType.WATER,
      partnerOrganisationId: "80000000-0000-4000-8000-000000000001",
      requestedQty: 60,
      status: PartnerResupplyStatus.REQUESTED,
      createdAt,
    };
    const prisma = client(allocationRecord(), [resupply]);
    const repository = new PrismaReliefAllocationCommandRepository(prisma);

    const result = await repository.findByOfficerAndIdempotencyKey(officerId, key);

    expect(prisma.partnerResupplyRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { reliefRequestId: requestId, createdAt },
      }),
    );
    expect(result).toEqual({
      allocationId: "30000000-0000-4000-8000-000000000001",
      officerId,
      idempotencyKey: key,
      requestId,
      requestStatus: ReliefRequestStatus.PARTIALLY_ALLOCATED,
      notes: "Committed note",
      createdAt,
      requestItems: [{ id: requestItemId, supplyType: SupplyType.WATER }],
      allocationItems: [
        {
          id: "31000000-0000-4000-8000-000000000001",
          requestItemId,
          supplyType: SupplyType.WATER,
          allocatedQty: 40,
        },
      ],
      resupplyRequests: [resupply],
      dispatch: {
        id: "33000000-0000-4000-8000-000000000001",
        rescueTeamId: "90000000-0000-4000-8000-000000000001",
        teamStatus: RescueTeamStatus.EN_ROUTE,
      },
    });
  });

  it("maps an allocation without an optional dispatch", async () => {
    const prisma = client({ ...allocationRecord(), dispatch: null });
    const repository = new PrismaReliefAllocationCommandRepository(prisma);

    const result = await repository.findByOfficerAndIdempotencyKey(officerId, key);

    expect(result?.dispatch).toBeNull();
  });
});

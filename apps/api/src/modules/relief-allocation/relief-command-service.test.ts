import {
  PartnerResupplyStatus,
  ReliefRequestStatus,
  RescueTeamStatus,
  SupplyType,
} from "@disaster/domain";
import type { ReliefAllocationCommand, ReliefAllocationReceipt } from "@disaster/shared-types";
import { describe, expect, it, vi } from "vitest";

import type {
  PersistedReliefAllocation,
  ReliefAllocationCommandRepository,
  ReliefAllocationTransactionPort,
} from "./relief-command-repository.js";
import { ReliefAllocationCommandService } from "./relief-command-service.js";

const ids = {
  district: "00000000-0000-4000-8000-000000000001",
  officer: "10000000-0000-4000-8000-000000000001",
  otherOfficer: "10000000-0000-4000-8000-000000000002",
  key: "20000000-0000-4000-8000-000000000001",
  request: "70000000-0000-4000-8000-000000000001",
  otherRequest: "70000000-0000-4000-8000-000000000002",
  waterItem: "71000000-0000-4000-8000-000000000001",
  medicalItem: "71000000-0000-4000-8000-000000000002",
  rationItem: "71000000-0000-4000-8000-000000000003",
  partnerA: "80000000-0000-4000-8000-000000000001",
  partnerB: "80000000-0000-4000-8000-000000000002",
  team: "90000000-0000-4000-8000-000000000001",
} as const;

const actor = { officerId: ids.officer, districtId: ids.district } as const;
const committedAt = new Date("2026-09-25T12:00:00.000Z");

function persistedAllocation(
  overrides: Partial<PersistedReliefAllocation> = {},
): PersistedReliefAllocation {
  return {
    allocationId: "30000000-0000-4000-8000-000000000001",
    officerId: ids.officer,
    idempotencyKey: ids.key,
    requestId: ids.request,
    requestStatus: ReliefRequestStatus.PARTIALLY_ALLOCATED,
    notes: "Medical kits partially allocated.",
    createdAt: committedAt,
    requestItems: [
      { id: ids.waterItem, supplyType: SupplyType.WATER },
      { id: ids.medicalItem, supplyType: SupplyType.MEDICAL_KIT },
      { id: ids.rationItem, supplyType: SupplyType.DRY_RATIONS },
    ],
    allocationItems: [
      {
        id: "31000000-0000-4000-8000-000000000001",
        requestItemId: ids.waterItem,
        supplyType: SupplyType.WATER,
        allocatedQty: 100,
      },
      {
        id: "31000000-0000-4000-8000-000000000002",
        requestItemId: ids.medicalItem,
        supplyType: SupplyType.MEDICAL_KIT,
        allocatedQty: 8,
      },
    ],
    resupplyRequests: [
      {
        id: "32000000-0000-4000-8000-000000000001",
        supplyType: SupplyType.MEDICAL_KIT,
        partnerOrganisationId: ids.partnerA,
        requestedQty: 12,
        status: PartnerResupplyStatus.REQUESTED,
        createdAt: committedAt,
      },
      {
        id: "32000000-0000-4000-8000-000000000002",
        supplyType: SupplyType.DRY_RATIONS,
        partnerOrganisationId: ids.partnerB,
        requestedQty: 50,
        status: PartnerResupplyStatus.ACKNOWLEDGED,
        createdAt: committedAt,
      },
    ],
    dispatch: {
      id: "33000000-0000-4000-8000-000000000001",
      rescueTeamId: ids.team,
      teamStatus: RescueTeamStatus.EN_ROUTE,
    },
    ...overrides,
  };
}

function command(overrides: Partial<ReliefAllocationCommand> = {}): ReliefAllocationCommand {
  return {
    requestVersion: 4,
    items: [
      { requestItemId: ids.waterItem, allocateQty: 100 },
      { requestItemId: ids.medicalItem, allocateQty: 8 },
      { requestItemId: ids.rationItem, allocateQty: 0 },
    ],
    shortages: [
      { requestItemId: ids.medicalItem, partnerOrganisationId: ids.partnerA },
      { requestItemId: ids.rationItem, partnerOrganisationId: ids.partnerB },
    ],
    rescueTeamId: ids.team,
    notes: "  Medical kits partially allocated.  ",
    ...overrides,
  };
}

function receipt(): ReliefAllocationReceipt {
  return {
    allocationId: "30000000-0000-4000-8000-000000000099",
    requestId: ids.request,
    requestStatus: ReliefRequestStatus.ALLOCATED,
    items: [{ supplyType: SupplyType.WATER, allocatedQty: 10 }],
    resupplyRequests: [],
    dispatch: null,
    createdAt: "2026-09-25T13:00:00.000Z",
  };
}

function repository(record: PersistedReliefAllocation | null = persistedAllocation()) {
  return {
    findByOfficerAndIdempotencyKey: vi.fn<
      ReliefAllocationCommandRepository["findByOfficerAndIdempotencyKey"]
    >(async () => record),
  };
}

function transactionPort(result: ReliefAllocationReceipt = receipt()) {
  return {
    execute: vi.fn<ReliefAllocationTransactionPort["execute"]>(async () => result),
  };
}

describe("officer-scoped allocation recovery", () => {
  it("returns an authoritative persisted receipt for the owning officer and key", async () => {
    const repo = repository();
    const result = await new ReliefAllocationCommandService(repo).getReceiptByIdempotencyKey(
      actor,
      ids.key,
    );

    expect(repo.findByOfficerAndIdempotencyKey).toHaveBeenCalledWith(ids.officer, ids.key);
    expect(result).toEqual({
      allocationId: "30000000-0000-4000-8000-000000000001",
      requestId: ids.request,
      requestStatus: ReliefRequestStatus.PARTIALLY_ALLOCATED,
      items: [
        { supplyType: SupplyType.WATER, allocatedQty: 100 },
        { supplyType: SupplyType.MEDICAL_KIT, allocatedQty: 8 },
      ],
      resupplyRequests: [
        {
          id: "32000000-0000-4000-8000-000000000001",
          supplyType: SupplyType.MEDICAL_KIT,
          requestedQty: 12,
          status: PartnerResupplyStatus.REQUESTED,
        },
        {
          id: "32000000-0000-4000-8000-000000000002",
          supplyType: SupplyType.DRY_RATIONS,
          requestedQty: 50,
          status: PartnerResupplyStatus.ACKNOWLEDGED,
        },
      ],
      dispatch: {
        id: "33000000-0000-4000-8000-000000000001",
        teamId: ids.team,
        status: RescueTeamStatus.EN_ROUTE,
      },
      createdAt: "2026-09-25T12:00:00.000Z",
    });
    expect(result.items).not.toContainEqual(expect.objectContaining({ allocatedQty: 0 }));
  });

  it("returns not found when the officer-scoped lookup is empty", async () => {
    await expect(
      new ReliefAllocationCommandService(repository(null)).getReceiptByIdempotencyKey(
        actor,
        ids.key,
      ),
    ).rejects.toMatchObject({ code: "ALLOCATION_NOT_FOUND" });
  });

  it("rejects a repository result that violates officer isolation", async () => {
    const record = persistedAllocation({ officerId: ids.otherOfficer });
    await expect(
      new ReliefAllocationCommandService(repository(record)).getReceiptByIdempotencyKey(
        actor,
        ids.key,
      ),
    ).rejects.toMatchObject({ code: "ALLOCATION_DATA_INTEGRITY_ERROR" });
  });

  it("maps lookup failures to a sanitized dependency error", async () => {
    const repo = repository();
    repo.findByOfficerAndIdempotencyKey.mockRejectedValue(new Error("database credentials"));

    await expect(
      new ReliefAllocationCommandService(repo).getReceiptByIdempotencyKey(actor, ids.key),
    ).rejects.toMatchObject({
      code: "ALLOCATION_DEPENDENCY_UNAVAILABLE",
      message: "Allocation recovery data is temporarily unavailable.",
    });
  });

  it.each([
    [
      "zero allocation item",
      persistedAllocation({
        allocationItems: [{ ...persistedAllocation().allocationItems[0]!, allocatedQty: 0 }],
      }),
    ],
    [
      "uncorrelated resupply timestamp",
      persistedAllocation({
        resupplyRequests: [
          {
            ...persistedAllocation().resupplyRequests[0]!,
            createdAt: new Date("2026-09-25T12:00:01.000Z"),
          },
        ],
      }),
    ],
    [
      "invalid dispatch state",
      persistedAllocation({
        dispatch: {
          ...persistedAllocation().dispatch!,
          teamStatus: RescueTeamStatus.AVAILABLE,
        },
      }),
    ],
  ])("fails safely for malformed persisted data: %s", async (_label, record) => {
    await expect(
      new ReliefAllocationCommandService(repository(record)).getReceiptByIdempotencyKey(
        actor,
        ids.key,
      ),
    ).rejects.toMatchObject({ code: "ALLOCATION_DATA_INTEGRITY_ERROR" });
  });

  it("reconstructs a receipt without an optional dispatch", async () => {
    const result = await new ReliefAllocationCommandService(
      repository(persistedAllocation({ dispatch: null })),
    ).getReceiptByIdempotencyKey(actor, ids.key);

    expect(result.dispatch).toBeNull();
  });
});

describe("same-intent idempotent allocation replay", () => {
  it.each([
    ["exact command", command()],
    ["different item order", command({ items: [...command().items].reverse() })],
    ["different partner order", command({ shortages: [...command().shortages].reverse() })],
    ["equivalent trimmed notes", command({ notes: "Medical kits partially allocated." })],
    ["different requestVersion only", command({ requestVersion: 999 })],
  ])("returns the existing receipt for %s", async (_label, replayCommand) => {
    const port = transactionPort();
    const result = await new ReliefAllocationCommandService(
      repository(),
      port,
    ).allocateReliefResources({
      actor,
      requestId: ids.request,
      idempotencyKey: ids.key,
      command: replayCommand,
    });

    expect(result.kind).toBe("REPLAYED");
    expect(result.receipt.allocationId).toBe("30000000-0000-4000-8000-000000000001");
    expect(result.receipt.requestStatus).toBe(ReliefRequestStatus.PARTIALLY_ALLOCATED);
    expect(result.receipt.createdAt).toBe("2026-09-25T12:00:00.000Z");
    expect(port.execute).not.toHaveBeenCalled();
  });
});

describe("idempotency mismatch", () => {
  it.each([
    ["different request", ids.otherRequest, command()],
    [
      "changed quantity",
      ids.request,
      command({
        items: command().items.map((item) =>
          item.requestItemId === ids.medicalItem ? { ...item, allocateQty: 7 } : item,
        ),
      }),
    ],
    [
      "changed partner",
      ids.request,
      command({
        shortages: command().shortages.map((selection) =>
          selection.requestItemId === ids.medicalItem
            ? { ...selection, partnerOrganisationId: ids.partnerB }
            : selection,
        ),
      }),
    ],
    ["changed rescue team", ids.request, command({ rescueTeamId: ids.otherOfficer })],
    ["materially changed notes", ids.request, command({ notes: "Different intent." })],
  ])("rejects %s", async (_label, requestId, changedCommand) => {
    const port = transactionPort();
    await expect(
      new ReliefAllocationCommandService(repository(), port).allocateReliefResources({
        actor,
        requestId,
        idempotencyKey: ids.key,
        command: changedCommand,
      }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_MISMATCH" });
    expect(port.execute).not.toHaveBeenCalled();
  });
});

describe("fresh allocation command orchestration", () => {
  it("performs idempotency lookup first and then reaches the future transaction port", async () => {
    const repo = repository(null);
    const port = transactionPort();
    const service = new ReliefAllocationCommandService(repo, port);

    const result = await service.allocateReliefResources({
      actor,
      requestId: ids.request,
      idempotencyKey: ids.key,
      command: command(),
    });

    expect(result).toEqual({ kind: "CREATED", receipt: receipt() });
    expect(repo.findByOfficerAndIdempotencyKey).toHaveBeenCalledBefore(port.execute);
    expect(port.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        officerId: ids.officer,
        districtId: ids.district,
        requestId: ids.request,
        idempotencyKey: ids.key,
        command: expect.objectContaining({ requestVersion: 4 }),
        canonicalIntent: expect.any(String),
      }),
    );
  });

  it("never reports a fresh command as committed without a transaction port", async () => {
    await expect(
      new ReliefAllocationCommandService(repository(null)).allocateReliefResources({
        actor,
        requestId: ids.request,
        idempotencyKey: ids.key,
        command: command(),
      }),
    ).rejects.toMatchObject({ code: "ALLOCATION_TRANSACTION_NOT_AVAILABLE" });
  });

  it("looks up idempotency before rejecting an invalid fresh command", async () => {
    const repo = repository(null);
    const port = transactionPort();
    await expect(
      new ReliefAllocationCommandService(repo, port).allocateReliefResources({
        actor,
        requestId: "bad-request-id",
        idempotencyKey: ids.key,
        command: command(),
      }),
    ).rejects.toMatchObject({ code: "INVALID_ALLOCATION_COMMAND" });
    expect(repo.findByOfficerAndIdempotencyKey).toHaveBeenCalledOnce();
    expect(port.execute).not.toHaveBeenCalled();
  });
});

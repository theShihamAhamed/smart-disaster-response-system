import type { Prisma, PrismaClient } from "@prisma/client";

import type {
  PersistedReliefAllocation,
  ReliefAllocationCommandRepository,
} from "./relief-command-repository.js";

const allocationRecoverySelect = {
  id: true,
  officerId: true,
  idempotencyKey: true,
  requestId: true,
  notes: true,
  createdAt: true,
  request: {
    select: {
      status: true,
      items: {
        orderBy: [{ supplyType: "asc" }, { id: "asc" }],
        select: { id: true, supplyType: true },
      },
    },
  },
  items: {
    orderBy: [{ supplyType: "asc" }, { id: "asc" }],
    select: {
      id: true,
      requestItemId: true,
      supplyType: true,
      allocatedQty: true,
    },
  },
  dispatch: {
    select: {
      id: true,
      rescueTeamId: true,
      rescueTeam: { select: { status: true } },
    },
  },
} as const satisfies Prisma.ResourceAllocationSelect;

type PrismaRecoveryAllocation = Prisma.ResourceAllocationGetPayload<{
  select: typeof allocationRecoverySelect;
}>;

export class PrismaReliefAllocationCommandRepository implements ReliefAllocationCommandRepository {
  public constructor(private readonly client: PrismaClient) {}

  public async findByOfficerAndIdempotencyKey(
    officerId: string,
    idempotencyKey: string,
  ): Promise<PersistedReliefAllocation | null> {
    const allocation: PrismaRecoveryAllocation | null =
      await this.client.resourceAllocation.findUnique({
        where: { officerId_idempotencyKey: { officerId, idempotencyKey } },
        select: allocationRecoverySelect,
      });
    if (!allocation) return null;

    const resupplyRequests = await this.client.partnerResupplyRequest.findMany({
      where: {
        reliefRequestId: allocation.requestId,
        createdAt: allocation.createdAt,
      },
      orderBy: [{ supplyType: "asc" }, { id: "asc" }],
      select: {
        id: true,
        supplyType: true,
        partnerOrganisationId: true,
        requestedQty: true,
        status: true,
        createdAt: true,
      },
    });

    return {
      allocationId: allocation.id,
      officerId: allocation.officerId,
      idempotencyKey: allocation.idempotencyKey,
      requestId: allocation.requestId,
      requestStatus: allocation.request.status,
      notes: allocation.notes,
      createdAt: allocation.createdAt,
      requestItems: allocation.request.items,
      allocationItems: allocation.items,
      resupplyRequests,
      dispatch: allocation.dispatch
        ? {
            id: allocation.dispatch.id,
            rescueTeamId: allocation.dispatch.rescueTeamId,
            teamStatus: allocation.dispatch.rescueTeam.status,
          }
        : null,
    };
  }
}

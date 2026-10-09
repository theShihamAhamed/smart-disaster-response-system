import type { Prisma, PrismaClient } from "@prisma/client";
import {
  ReliefRequestStatus,
  RescueTeamStatus,
  type ReliefRequestStatus as ReliefRequestStatusValue,
  type SupplyType,
} from "@disaster/domain";

import type {
  ReliefQueueReadCriteria,
  ReliefReadAllocationItemRecord,
  ReliefReadRepository,
  ReliefReadRequestDetailsRecord,
  ReliefReadRequestItemRecord,
  ReliefReadRequestSummaryRecord,
} from "./relief-read-repository.js";

const ACTIONABLE_STATUSES: readonly ReliefRequestStatusValue[] = [
  ReliefRequestStatus.AWAITING_ALLOCATION,
  ReliefRequestStatus.PARTIALLY_ALLOCATED,
  ReliefRequestStatus.AWAITING_RESUPPLY,
];
const ACTIONABLE_STATUS_SET = new Set<ReliefRequestStatusValue>(ACTIONABLE_STATUSES);

const reliefRequestItemSelect = {
  id: true,
  supplyType: true,
  requestedQty: true,
  allocationItems: {
    select: {
      requestItemId: true,
      supplyType: true,
      allocatedQty: true,
      allocation: { select: { requestId: true } },
    },
  },
} as const satisfies Prisma.ReliefRequestItemSelect;

const reliefRequestSummarySelect = {
  id: true,
  status: true,
  priorityNote: true,
  createdAt: true,
  version: true,
  shelter: {
    select: {
      id: true,
      name: true,
      districtId: true,
      capacity: true,
      currentOccupancy: true,
      location: {
        select: {
          districtId: true,
          latitude: true,
          longitude: true,
          address: true,
        },
      },
    },
  },
  targetZone: {
    select: { id: true, name: true, districtId: true, severity: true },
  },
  items: {
    orderBy: { supplyType: "asc" },
    select: reliefRequestItemSelect,
  },
} as const satisfies Prisma.ReliefRequestSelect;

const reliefRequestDetailsSelect = {
  ...reliefRequestSummarySelect,
  allocations: {
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      createdAt: true,
      items: {
        orderBy: { id: "asc" },
        select: {
          requestItemId: true,
          supplyType: true,
          allocatedQty: true,
          allocation: { select: { requestId: true } },
        },
      },
    },
  },
} as const satisfies Prisma.ReliefRequestSelect;

type PrismaRequestSummary = Prisma.ReliefRequestGetPayload<{
  select: typeof reliefRequestSummarySelect;
}>;
type PrismaRequestDetails = Prisma.ReliefRequestGetPayload<{
  select: typeof reliefRequestDetailsSelect;
}>;
type PrismaRequestItem = PrismaRequestSummary["items"][number];
type PrismaAllocationItem = PrismaRequestItem["allocationItems"][number];

function mapAllocationItem(item: PrismaAllocationItem): ReliefReadAllocationItemRecord {
  return {
    requestItemId: item.requestItemId,
    supplyType: item.supplyType,
    allocatedQty: item.allocatedQty,
    allocationRequestId: item.allocation.requestId,
  };
}

function mapRequestItem(item: PrismaRequestItem): ReliefReadRequestItemRecord {
  return {
    id: item.id,
    supplyType: item.supplyType,
    requestedQty: item.requestedQty,
    allocationItems: item.allocationItems.map(mapAllocationItem),
  };
}

function mapSummary(request: PrismaRequestSummary): ReliefReadRequestSummaryRecord {
  return {
    id: request.id,
    status: request.status,
    priorityNote: request.priorityNote,
    createdAt: request.createdAt,
    version: request.version,
    shelter: {
      id: request.shelter.id,
      name: request.shelter.name,
      districtId: request.shelter.districtId,
      capacity: request.shelter.capacity,
      currentOccupancy: request.shelter.currentOccupancy,
      location: {
        districtId: request.shelter.location.districtId,
        latitude: request.shelter.location.latitude.toNumber(),
        longitude: request.shelter.location.longitude.toNumber(),
        address: request.shelter.location.address,
      },
    },
    targetZone: {
      id: request.targetZone.id,
      name: request.targetZone.name,
      districtId: request.targetZone.districtId,
      severity: request.targetZone.severity,
    },
    items: request.items.map(mapRequestItem),
  };
}

export class PrismaReliefReadRepository implements ReliefReadRepository {
  public constructor(private readonly client: PrismaClient) {}

  public async listActionableRequests(
    criteria: ReliefQueueReadCriteria,
  ): Promise<readonly ReliefReadRequestSummaryRecord[]> {
    const statuses =
      criteria.status === undefined
        ? ACTIONABLE_STATUSES
        : ACTIONABLE_STATUS_SET.has(criteria.status)
          ? [criteria.status]
          : [];

    const requests = await this.client.reliefRequest.findMany({
      where: {
        shelter: { districtId: criteria.districtId },
        status: { in: [...statuses] },
        ...(criteria.zoneSeverity === undefined
          ? {}
          : { targetZone: { severity: criteria.zoneSeverity } }),
      },
      select: reliefRequestSummarySelect,
    });

    return requests.map(mapSummary);
  }

  public async findRequestById(requestId: string): Promise<ReliefReadRequestDetailsRecord | null> {
    const request = await this.client.reliefRequest.findUnique({
      where: { id: requestId },
      select: reliefRequestDetailsSelect,
    });
    if (!request) return null;

    const summary = mapSummary(request as PrismaRequestDetails);
    return {
      ...summary,
      allocations: request.allocations.map((allocation) => ({
        id: allocation.id,
        createdAt: allocation.createdAt,
        items: allocation.items.map(mapAllocationItem),
      })),
    };
  }

  public async listWarehouseStock(districtId: string, supplyTypes: readonly SupplyType[]) {
    return this.client.warehouseStock.findMany({
      where: { districtId, supplyType: { in: [...supplyTypes] } },
      orderBy: { supplyType: "asc" },
      select: {
        districtId: true,
        supplyType: true,
        availableQty: true,
        version: true,
        syncedAt: true,
      },
    });
  }

  public async listActivePartners(districtId: string) {
    return this.client.partnerOrganisation.findMany({
      where: { districtId, active: true },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      select: { id: true, districtId: true, name: true, type: true, active: true },
    });
  }

  public async listAvailableRescueTeams(districtId: string) {
    return this.client.rescueTeam.findMany({
      where: { districtId, status: RescueTeamStatus.AVAILABLE },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      select: { id: true, districtId: true, name: true, status: true },
    });
  }
}

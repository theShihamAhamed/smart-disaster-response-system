import {
  ReliefRequestStatus,
  RescueTeamStatus,
  ZoneSeverity,
  type ReliefRequestStatus as ReliefRequestStatusValue,
  type SupplyType,
} from "@disaster/domain";
import type {
  ReliefRequestDetails,
  ReliefRequestItemDetails,
  ReliefRequestQueueItem,
  ReliefRequestQueueQuery,
  ReliefRequestQueueResponse,
} from "@disaster/shared-types";

import { calculateOutstanding, rankReliefRequests, ReliefRuleError } from "./relief-rules.js";
import { ReliefReadError } from "./relief-read-errors.js";
import type {
  ReliefReadAllocationItemRecord,
  ReliefReadRepository,
  ReliefReadRequestDetailsRecord,
  ReliefReadRequestItemRecord,
  ReliefReadRequestSummaryRecord,
  WarehouseStockReadRecord,
} from "./relief-read-repository.js";

const ACTIONABLE_STATUSES = new Set<ReliefRequestStatusValue>([
  ReliefRequestStatus.AWAITING_ALLOCATION,
  ReliefRequestStatus.PARTIALLY_ALLOCATED,
  ReliefRequestStatus.AWAITING_RESUPPLY,
]);

export interface ReliefReadActor {
  readonly officerId: string;
  readonly districtId: string;
}

export interface ReliefReadOperations {
  listRankedRequests(
    actor: ReliefReadActor,
    query: ReliefRequestQueueQuery,
  ): Promise<ReliefRequestQueueResponse>;
  getRequestDetails(actor: ReliefReadActor, requestId: string): Promise<ReliefRequestDetails>;
}

function dataIntegrityError(): ReliefReadError {
  return new ReliefReadError(
    "RELIEF_DATA_INTEGRITY_ERROR",
    "Relief request data is inconsistent and cannot be displayed safely.",
  );
}

function assertValidDate(value: Date): string {
  const time = value.getTime();
  if (!Number.isFinite(time)) throw dataIntegrityError();
  return value.toISOString();
}

function assertDistrictConsistency(
  request: ReliefReadRequestSummaryRecord,
  districtId: string,
): void {
  if (
    request.shelter.districtId !== districtId ||
    request.shelter.location.districtId !== districtId ||
    request.targetZone.districtId !== districtId
  ) {
    throw dataIntegrityError();
  }
}

function assertRequestDisplayIntegrity(request: ReliefReadRequestSummaryRecord): void {
  const { latitude, longitude } = request.shelter.location;
  if (
    !Number.isFinite(latitude) ||
    latitude < -90 ||
    latitude > 90 ||
    !Number.isFinite(longitude) ||
    longitude < -180 ||
    longitude > 180 ||
    !Number.isSafeInteger(request.version) ||
    request.version <= 0
  ) {
    throw dataIntegrityError();
  }

  try {
    rankReliefRequests([
      {
        requestId: request.id,
        zoneSeverity: request.targetZone.severity,
        currentOccupancy: request.shelter.currentOccupancy,
        capacity: request.shelter.capacity,
        createdAt: assertValidDate(request.createdAt),
      },
    ]);
  } catch (error) {
    if (error instanceof ReliefRuleError || error instanceof ReliefReadError) {
      throw dataIntegrityError();
    }
    throw error;
  }
}

function assertAllocationItemConsistency(
  requestId: string,
  requestItem: ReliefReadRequestItemRecord,
  allocationItem: ReliefReadAllocationItemRecord,
): void {
  if (
    allocationItem.requestItemId !== requestItem.id ||
    allocationItem.supplyType !== requestItem.supplyType ||
    allocationItem.allocationRequestId !== requestId ||
    !Number.isSafeInteger(allocationItem.allocatedQty) ||
    allocationItem.allocatedQty <= 0
  ) {
    throw dataIntegrityError();
  }
}

function calculateItemOutstanding(
  requestId: string,
  item: ReliefReadRequestItemRecord,
): { readonly previouslyAllocatedQty: number; readonly outstandingQty: number } {
  for (const allocationItem of item.allocationItems) {
    assertAllocationItemConsistency(requestId, item, allocationItem);
  }

  const allocatedQuantities = item.allocationItems.map(({ allocatedQty }) => allocatedQty);
  try {
    const outstandingQty = calculateOutstanding(item.requestedQty, allocatedQuantities);
    return {
      previouslyAllocatedQty: item.requestedQty - outstandingQty,
      outstandingQty,
    };
  } catch (error) {
    if (error instanceof ReliefRuleError) throw dataIntegrityError();
    throw error;
  }
}

function mapQueueItem(request: ReliefReadRequestSummaryRecord): ReliefRequestQueueItem {
  const outstandingSupplies = request.items.map((item) => ({
    supplyType: item.supplyType,
    outstandingQty: calculateItemOutstanding(request.id, item).outstandingQty,
  }));

  if (
    outstandingSupplies.length === 0 ||
    outstandingSupplies.every((item) => item.outstandingQty === 0)
  ) {
    throw dataIntegrityError();
  }

  return {
    requestId: request.id,
    requestVersion: request.version,
    status: request.status,
    createdAt: assertValidDate(request.createdAt),
    shelter: {
      id: request.shelter.id,
      name: request.shelter.name,
      capacity: request.shelter.capacity,
      currentOccupancy: request.shelter.currentOccupancy,
      occupancyRate: request.shelter.currentOccupancy / request.shelter.capacity,
    },
    targetZone: {
      id: request.targetZone.id,
      name: request.targetZone.name,
      severity: request.targetZone.severity,
    },
    outstandingSupplies,
  };
}

function mapDetailsItem(
  requestId: string,
  item: ReliefReadRequestItemRecord,
  stock: WarehouseStockReadRecord,
): ReliefRequestItemDetails {
  const totals = calculateItemOutstanding(requestId, item);
  return {
    requestItemId: item.id,
    supplyType: item.supplyType,
    requestedQty: item.requestedQty,
    previouslyAllocatedQty: totals.previouslyAllocatedQty,
    outstandingQty: totals.outstandingQty,
    warehouseStock: {
      availableQty: stock.availableQty,
      version: stock.version,
      syncedAt: assertValidDate(stock.syncedAt),
    },
  };
}

function uniqueSupplyTypes(request: ReliefReadRequestDetailsRecord): SupplyType[] {
  return [...new Set(request.items.map(({ supplyType }) => supplyType))];
}

export class ReliefReadService implements ReliefReadOperations {
  public constructor(private readonly repository: ReliefReadRepository) {}

  public async listRankedRequests(
    actor: ReliefReadActor,
    query: ReliefRequestQueueQuery,
  ): Promise<ReliefRequestQueueResponse> {
    let records: readonly ReliefReadRequestSummaryRecord[];
    try {
      records = await this.repository.listActionableRequests({
        districtId: actor.districtId,
        ...(query.status === undefined ? {} : { status: query.status }),
        ...(query.zoneSeverity === undefined ? {} : { zoneSeverity: query.zoneSeverity }),
      });
    } catch {
      throw new ReliefReadError(
        "RELIEF_READ_UNAVAILABLE",
        "Relief request data is temporarily unavailable.",
      );
    }

    const queueItems = records
      .filter((request) => request.shelter.districtId === actor.districtId)
      .filter((request) => ACTIONABLE_STATUSES.has(request.status))
      .filter((request) => query.status === undefined || request.status === query.status)
      .filter(
        (request) =>
          query.zoneSeverity === undefined || request.targetZone.severity === query.zoneSeverity,
      )
      .map((request) => {
        assertDistrictConsistency(request, actor.districtId);
        assertRequestDisplayIntegrity(request);
        return mapQueueItem(request);
      });

    try {
      return rankReliefRequests(
        queueItems.map((item) => ({
          value: item,
          requestId: item.requestId,
          zoneSeverity: item.targetZone.severity,
          currentOccupancy: item.shelter.currentOccupancy,
          capacity: item.shelter.capacity,
          createdAt: item.createdAt,
        })),
      ).map(({ value }) => value);
    } catch (error) {
      if (error instanceof ReliefRuleError) throw dataIntegrityError();
      throw error;
    }
  }

  public async getRequestDetails(
    actor: ReliefReadActor,
    requestId: string,
  ): Promise<ReliefRequestDetails> {
    let request: ReliefReadRequestDetailsRecord | null;
    try {
      request = await this.repository.findRequestById(requestId);
    } catch {
      throw new ReliefReadError(
        "RELIEF_READ_UNAVAILABLE",
        "Relief request data is temporarily unavailable.",
      );
    }

    if (!request || request.shelter.districtId !== actor.districtId) {
      throw new ReliefReadError("RELIEF_REQUEST_NOT_FOUND", "The relief request was not found.");
    }

    assertDistrictConsistency(request, actor.districtId);
    assertRequestDisplayIntegrity(request);
    if (request.items.length === 0) throw dataIntegrityError();

    const supplyTypes = uniqueSupplyTypes(request);
    let stockRows: readonly WarehouseStockReadRecord[];
    let partners: Awaited<ReturnType<ReliefReadRepository["listActivePartners"]>>;
    let teams: Awaited<ReturnType<ReliefReadRepository["listAvailableRescueTeams"]>>;
    try {
      [stockRows, partners, teams] = await Promise.all([
        this.repository.listWarehouseStock(actor.districtId, supplyTypes),
        this.repository.listActivePartners(actor.districtId),
        request.targetZone.severity === ZoneSeverity.CRITICAL
          ? this.repository.listAvailableRescueTeams(actor.districtId)
          : Promise.resolve([]),
      ]);
    } catch {
      throw new ReliefReadError(
        "RELIEF_READ_UNAVAILABLE",
        "Relief request data is temporarily unavailable.",
      );
    }

    const stockBySupplyType = new Map<SupplyType, WarehouseStockReadRecord>();
    for (const stock of stockRows) {
      if (
        stock.districtId !== actor.districtId ||
        !supplyTypes.includes(stock.supplyType) ||
        stockBySupplyType.has(stock.supplyType) ||
        !Number.isSafeInteger(stock.availableQty) ||
        stock.availableQty < 0 ||
        !Number.isSafeInteger(stock.version) ||
        stock.version <= 0
      ) {
        throw dataIntegrityError();
      }
      stockBySupplyType.set(stock.supplyType, stock);
    }
    if (stockBySupplyType.size !== supplyTypes.length) {
      throw new ReliefReadError(
        "STOCK_LEDGER_UNAVAILABLE",
        "Current warehouse stock is unavailable for one or more requested supplies.",
      );
    }

    const requestItemsById = new Map(request.items.map((item) => [item.id, item]));
    const previousAllocations = request.allocations.map((allocation) => ({
      allocationId: allocation.id,
      createdAt: assertValidDate(allocation.createdAt),
      items: allocation.items.map((item) => {
        const requestItem = requestItemsById.get(item.requestItemId);
        if (!requestItem) throw dataIntegrityError();
        assertAllocationItemConsistency(request.id, requestItem, item);
        return {
          requestItemId: item.requestItemId,
          supplyType: item.supplyType,
          allocatedQty: item.allocatedQty,
        };
      }),
    }));

    const items = request.items.map((item) => {
      const stock = stockBySupplyType.get(item.supplyType);
      if (!stock) {
        throw new ReliefReadError(
          "STOCK_LEDGER_UNAVAILABLE",
          "Current warehouse stock is unavailable for one or more requested supplies.",
        );
      }
      return mapDetailsItem(request.id, item, stock);
    });
    const hasOutstandingDemand = items.some(({ outstandingQty }) => outstandingQty > 0);
    if (
      (request.status === ReliefRequestStatus.ALLOCATED && hasOutstandingDemand) ||
      (request.status !== ReliefRequestStatus.ALLOCATED && !hasOutstandingDemand)
    ) {
      throw dataIntegrityError();
    }

    return {
      requestId: request.id,
      requestVersion: request.version,
      status: request.status,
      priorityNote: request.priorityNote,
      createdAt: assertValidDate(request.createdAt),
      shelter: {
        id: request.shelter.id,
        name: request.shelter.name,
        capacity: request.shelter.capacity,
        currentOccupancy: request.shelter.currentOccupancy,
        occupancyRate: request.shelter.currentOccupancy / request.shelter.capacity,
        location: {
          latitude: request.shelter.location.latitude,
          longitude: request.shelter.location.longitude,
          address: request.shelter.location.address,
        },
      },
      targetZone: {
        id: request.targetZone.id,
        name: request.targetZone.name,
        severity: request.targetZone.severity,
      },
      items,
      previousAllocations,
      eligiblePartners: partners
        .filter((partner) => partner.active && partner.districtId === actor.districtId)
        .map(({ id, name, type }) => ({ id, name, type })),
      availableRescueTeams: teams
        .filter(
          (team) =>
            team.districtId === actor.districtId && team.status === RescueTeamStatus.AVAILABLE,
        )
        .map(({ id, name }) => ({ id, name, status: RescueTeamStatus.AVAILABLE })),
    };
  }
}

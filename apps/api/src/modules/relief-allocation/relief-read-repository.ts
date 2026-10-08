import type {
  PartnerOrganisationType,
  ReliefRequestStatus,
  RescueTeamStatus,
  SupplyType,
  ZoneSeverity,
} from "@disaster/domain";

export interface ReliefReadAllocationItemRecord {
  readonly requestItemId: string;
  readonly supplyType: SupplyType;
  readonly allocatedQty: number;
  readonly allocationRequestId: string;
}

export interface ReliefReadRequestItemRecord {
  readonly id: string;
  readonly supplyType: SupplyType;
  readonly requestedQty: number;
  readonly allocationItems: readonly ReliefReadAllocationItemRecord[];
}

export interface ReliefReadShelterRecord {
  readonly id: string;
  readonly name: string;
  readonly districtId: string;
  readonly capacity: number;
  readonly currentOccupancy: number;
  readonly location: {
    readonly districtId: string;
    readonly latitude: number;
    readonly longitude: number;
    readonly address: string | null;
  };
}

export interface ReliefReadTargetZoneRecord {
  readonly id: string;
  readonly name: string;
  readonly districtId: string;
  readonly severity: ZoneSeverity;
}

export interface ReliefReadRequestSummaryRecord {
  readonly id: string;
  readonly status: ReliefRequestStatus;
  readonly priorityNote: string | null;
  readonly createdAt: Date;
  readonly version: number;
  readonly shelter: ReliefReadShelterRecord;
  readonly targetZone: ReliefReadTargetZoneRecord;
  readonly items: readonly ReliefReadRequestItemRecord[];
}

export interface ReliefReadPreviousAllocationRecord {
  readonly id: string;
  readonly createdAt: Date;
  readonly items: readonly ReliefReadAllocationItemRecord[];
}

export interface ReliefReadRequestDetailsRecord extends ReliefReadRequestSummaryRecord {
  readonly allocations: readonly ReliefReadPreviousAllocationRecord[];
}

export interface WarehouseStockReadRecord {
  readonly districtId: string;
  readonly supplyType: SupplyType;
  readonly availableQty: number;
  readonly version: number;
  readonly syncedAt: Date;
}

export interface PartnerOrganisationReadRecord {
  readonly id: string;
  readonly districtId: string;
  readonly name: string;
  readonly type: PartnerOrganisationType;
  readonly active: boolean;
}

export interface RescueTeamReadRecord {
  readonly id: string;
  readonly districtId: string;
  readonly name: string;
  readonly status: RescueTeamStatus;
}

export interface ReliefQueueReadCriteria {
  readonly districtId: string;
  readonly status?: ReliefRequestStatus;
  readonly zoneSeverity?: ZoneSeverity;
}

export interface ReliefReadRepository {
  listActionableRequests(
    criteria: ReliefQueueReadCriteria,
  ): Promise<readonly ReliefReadRequestSummaryRecord[]>;
  findRequestById(requestId: string): Promise<ReliefReadRequestDetailsRecord | null>;
  listWarehouseStock(
    districtId: string,
    supplyTypes: readonly SupplyType[],
  ): Promise<readonly WarehouseStockReadRecord[]>;
  listActivePartners(districtId: string): Promise<readonly PartnerOrganisationReadRecord[]>;
  listAvailableRescueTeams(districtId: string): Promise<readonly RescueTeamReadRecord[]>;
}

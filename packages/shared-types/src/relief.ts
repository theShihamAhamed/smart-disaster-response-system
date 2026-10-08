import type {
  PartnerOrganisationType,
  PartnerResupplyStatus,
  ReliefRequestStatus,
  RescueTeamStatus,
  SupplyType,
  ZoneSeverity,
} from "@disaster/domain";

export interface ReliefRequestQueueQuery {
  readonly status?: ReliefRequestStatus;
  readonly zoneSeverity?: ZoneSeverity;
}

export interface ReliefShelterSummary {
  readonly id: string;
  readonly name: string;
  readonly capacity: number;
  readonly currentOccupancy: number;
  readonly occupancyRate: number;
}

export interface ReliefTargetZoneSummary {
  readonly id: string;
  readonly name: string;
  readonly severity: ZoneSeverity;
}

export interface OutstandingSupplySummary {
  readonly supplyType: SupplyType;
  readonly outstandingQty: number;
}

export interface ReliefRequestQueueItem {
  readonly requestId: string;
  readonly requestVersion: number;
  readonly status: ReliefRequestStatus;
  readonly createdAt: string;
  readonly shelter: ReliefShelterSummary;
  readonly targetZone: ReliefTargetZoneSummary;
  readonly outstandingSupplies: readonly OutstandingSupplySummary[];
}

export type ReliefRequestQueueResponse = readonly ReliefRequestQueueItem[];

export interface ReliefLocation {
  readonly latitude: number;
  readonly longitude: number;
  readonly address: string | null;
}

export interface ReliefRequestItemDetails {
  readonly requestItemId: string;
  readonly supplyType: SupplyType;
  readonly requestedQty: number;
  readonly previouslyAllocatedQty: number;
  readonly outstandingQty: number;
  readonly warehouseStock: {
    readonly availableQty: number;
    readonly version: number;
    readonly syncedAt: string;
  };
}

export interface PreviousReliefAllocation {
  readonly allocationId: string;
  readonly createdAt: string;
  readonly items: readonly {
    readonly requestItemId: string;
    readonly supplyType: SupplyType;
    readonly allocatedQty: number;
  }[];
}

export interface EligiblePartnerOrganisation {
  readonly id: string;
  readonly name: string;
  readonly type: PartnerOrganisationType;
}

export interface AvailableRescueTeam {
  readonly id: string;
  readonly name: string;
  readonly status: Extract<RescueTeamStatus, "AVAILABLE">;
}

export interface ReliefRequestDetails {
  readonly requestId: string;
  readonly requestVersion: number;
  readonly status: ReliefRequestStatus;
  readonly priorityNote: string | null;
  readonly createdAt: string;
  readonly shelter: ReliefShelterSummary & { readonly location: ReliefLocation };
  readonly targetZone: ReliefTargetZoneSummary;
  readonly items: readonly ReliefRequestItemDetails[];
  readonly previousAllocations: readonly PreviousReliefAllocation[];
  readonly eligiblePartners: readonly EligiblePartnerOrganisation[];
  readonly availableRescueTeams: readonly AvailableRescueTeam[];
}

export interface ReliefAllocationItemCommand {
  readonly requestItemId: string;
  readonly allocateQty: number;
}

export interface ReliefShortagePartnerSelection {
  readonly requestItemId: string;
  readonly partnerOrganisationId: string;
}

export interface ReliefAllocationCommand {
  readonly requestVersion: number;
  readonly items: readonly ReliefAllocationItemCommand[];
  readonly shortages: readonly ReliefShortagePartnerSelection[];
  readonly rescueTeamId?: string;
  readonly notes?: string;
}

export interface ReliefAllocationReceiptItem {
  readonly supplyType: SupplyType;
  readonly allocatedQty: number;
}

export interface ReliefResupplyReceipt {
  readonly id: string;
  readonly supplyType: SupplyType;
  readonly requestedQty: number;
  readonly status: PartnerResupplyStatus;
}

export interface ReliefDispatchReceipt {
  readonly id: string;
  readonly teamId: string;
  readonly status: Extract<RescueTeamStatus, "EN_ROUTE">;
}

export interface ReliefAllocationReceipt {
  readonly allocationId: string;
  readonly requestId: string;
  readonly requestStatus: ReliefRequestStatus;
  readonly items: readonly ReliefAllocationReceiptItem[];
  readonly resupplyRequests: readonly ReliefResupplyReceipt[];
  readonly dispatch: ReliefDispatchReceipt | null;
  readonly createdAt: string;
}

export type ReliefAllocationReceiptLookupResponse = ReliefAllocationReceipt;

export interface ReliefAllocationIdempotencyIdentity {
  readonly officerId: string;
  readonly idempotencyKey: string;
}

export type ReliefAllocationConflictCode =
  | "STOCK_CHANGED"
  | "REQUEST_CHANGED"
  | "REQUEST_ALREADY_ALLOCATED"
  | "TEAM_UNAVAILABLE"
  | "IDEMPOTENCY_MISMATCH"
  | "PARTNER_REQUIRED";

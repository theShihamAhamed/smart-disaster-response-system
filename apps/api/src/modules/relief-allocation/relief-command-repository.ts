import type {
  PartnerResupplyStatus,
  ReliefRequestStatus,
  RescueTeamStatus,
  SupplyType,
} from "@disaster/domain";
import type { ReliefAllocationCommand } from "@disaster/shared-types";

export interface PersistedRequestItemIdentity {
  readonly id: string;
  readonly supplyType: SupplyType;
}

export interface PersistedAllocationItem {
  readonly id: string;
  readonly requestItemId: string;
  readonly supplyType: SupplyType;
  readonly allocatedQty: number;
}

export interface PersistedResupplyRequest {
  readonly id: string;
  readonly supplyType: SupplyType;
  readonly partnerOrganisationId: string;
  readonly requestedQty: number;
  readonly status: PartnerResupplyStatus;
  readonly createdAt: Date;
}

export interface PersistedAllocationDispatch {
  readonly id: string;
  readonly rescueTeamId: string;
  readonly teamStatus: RescueTeamStatus;
}

export interface PersistedReliefAllocation {
  readonly allocationId: string;
  readonly officerId: string;
  readonly idempotencyKey: string;
  readonly requestId: string;
  readonly requestStatus: ReliefRequestStatus;
  readonly notes: string | null;
  readonly createdAt: Date;
  readonly requestItems: readonly PersistedRequestItemIdentity[];
  readonly allocationItems: readonly PersistedAllocationItem[];
  readonly resupplyRequests: readonly PersistedResupplyRequest[];
  readonly dispatch: PersistedAllocationDispatch | null;
}

export interface ReliefAllocationCommandRepository {
  findByOfficerAndIdempotencyKey(
    officerId: string,
    idempotencyKey: string,
  ): Promise<PersistedReliefAllocation | null>;
}

export interface PreparedReliefAllocationCommand {
  readonly officerId: string;
  readonly districtId: string;
  readonly requestId: string;
  readonly idempotencyKey: string;
  readonly command: ReliefAllocationCommand;
  readonly canonicalIntent: string;
}

export interface ReliefAllocationTransactionPort {
  execute(command: PreparedReliefAllocationCommand): Promise<ReliefAllocationTransactionResult>;
}

export type ReliefAllocationTransactionResult =
  { readonly kind: "COMMITTED" } | { readonly kind: "IDEMPOTENCY_RACE" };

import {
  ReliefRequestStatus,
  ZoneSeverity,
  type ZoneSeverity as ZoneSeverityValue,
} from "@disaster/domain";
import type { ReliefAllocationCommand, ReliefAllocationItemCommand } from "@disaster/shared-types";

export type ReliefRuleErrorCode =
  "INVALID_QUANTITY" | "OVER_ALLOCATION" | "INVALID_CAPACITY" | "INVALID_CREATED_AT";

export class ReliefRuleError extends Error {
  public constructor(
    public readonly code: ReliefRuleErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ReliefRuleError";
  }
}

function assertNonNegativeSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new ReliefRuleError("INVALID_QUANTITY", `${label} must be a non-negative safe integer.`);
  }
}

function assertPositiveSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new ReliefRuleError("INVALID_QUANTITY", `${label} must be a positive safe integer.`);
  }
}

export function calculateOutstanding(
  requestedQty: number,
  previousAllocatedQuantities: readonly number[],
): number {
  assertPositiveSafeInteger(requestedQty, "Requested quantity");

  const allocatedQty = previousAllocatedQuantities.reduce((total, quantity) => {
    assertNonNegativeSafeInteger(quantity, "Previously allocated quantity");
    const nextTotal = total + quantity;
    assertNonNegativeSafeInteger(nextTotal, "Previously allocated total");
    return nextTotal;
  }, 0);

  if (allocatedQty > requestedQty) {
    throw new ReliefRuleError(
      "OVER_ALLOCATION",
      "Previously allocated quantity exceeds requested quantity.",
    );
  }

  return requestedQty - allocatedQty;
}

export function calculateShortage(outstandingQty: number, allocateQty: number): number {
  assertNonNegativeSafeInteger(outstandingQty, "Outstanding quantity");
  assertNonNegativeSafeInteger(allocateQty, "Allocation quantity");

  if (allocateQty > outstandingQty) {
    throw new ReliefRuleError(
      "OVER_ALLOCATION",
      "Allocation quantity exceeds outstanding quantity.",
    );
  }

  return outstandingQty - allocateQty;
}

export interface ReliefStatusTotals {
  readonly totalRequestedQty: number;
  readonly totalAllocatedQty: number;
  readonly hasActiveResupply: boolean;
}

export function deriveReliefRequestStatus(totals: ReliefStatusTotals): ReliefRequestStatus {
  assertPositiveSafeInteger(totals.totalRequestedQty, "Total requested quantity");
  assertNonNegativeSafeInteger(totals.totalAllocatedQty, "Total allocated quantity");

  if (totals.totalAllocatedQty > totals.totalRequestedQty) {
    throw new ReliefRuleError(
      "OVER_ALLOCATION",
      "Total allocated quantity exceeds total requested quantity.",
    );
  }

  if (totals.totalAllocatedQty === totals.totalRequestedQty) {
    return ReliefRequestStatus.ALLOCATED;
  }

  if (totals.totalAllocatedQty > 0) {
    return ReliefRequestStatus.PARTIALLY_ALLOCATED;
  }

  if (totals.hasActiveResupply) {
    return ReliefRequestStatus.AWAITING_RESUPPLY;
  }

  return ReliefRequestStatus.AWAITING_ALLOCATION;
}

export interface RankableReliefRequest {
  readonly requestId: string;
  readonly zoneSeverity: ZoneSeverityValue;
  readonly currentOccupancy: number;
  readonly capacity: number;
  readonly createdAt: string;
}

const ZONE_PRIORITY: Readonly<Record<ZoneSeverityValue, number>> = {
  [ZoneSeverity.LOW]: 0,
  [ZoneSeverity.MODERATE]: 1,
  [ZoneSeverity.HIGH]: 2,
  [ZoneSeverity.CRITICAL]: 3,
};

interface PreparedRankedRequest<T extends RankableReliefRequest> {
  readonly value: T;
  readonly occupancyRate: number;
  readonly createdAtMs: number;
}

export function rankReliefRequests<T extends RankableReliefRequest>(requests: readonly T[]): T[] {
  const prepared: PreparedRankedRequest<T>[] = requests.map((request) => {
    assertNonNegativeSafeInteger(request.currentOccupancy, "Current occupancy");
    if (!Number.isSafeInteger(request.capacity) || request.capacity <= 0) {
      throw new ReliefRuleError("INVALID_CAPACITY", "Shelter capacity must be a positive integer.");
    }

    const createdAtMs = Date.parse(request.createdAt);
    if (!Number.isFinite(createdAtMs)) {
      throw new ReliefRuleError("INVALID_CREATED_AT", "Request creation time must be valid.");
    }

    return {
      value: request,
      occupancyRate: request.currentOccupancy / request.capacity,
      createdAtMs,
    };
  });

  prepared.sort((left, right) => {
    const severityDifference =
      ZONE_PRIORITY[right.value.zoneSeverity] - ZONE_PRIORITY[left.value.zoneSeverity];
    if (severityDifference !== 0) return severityDifference;

    const occupancyDifference = right.occupancyRate - left.occupancyRate;
    if (occupancyDifference !== 0) return occupancyDifference;

    const ageDifference = left.createdAtMs - right.createdAtMs;
    if (ageDifference !== 0) return ageDifference;

    return left.value.requestId.localeCompare(right.value.requestId);
  });

  return prepared.map(({ value }) => value);
}

export type AllocationDraftIssueCode =
  | "INVALID_QUANTITY"
  | "DUPLICATE_ALLOCATION_ITEM"
  | "DUPLICATE_SHORTAGE_SELECTION"
  | "UNKNOWN_SHORTAGE_ITEM"
  | "PARTNER_REQUIRED"
  | "UNEXPECTED_PARTNER_SELECTION"
  | "ZERO_ALLOCATION_WITHOUT_RESUPPLY"
  | "NOTES_TOO_LONG";

export interface AllocationDraftIssue {
  readonly code: AllocationDraftIssueCode;
  readonly requestItemId?: string;
}

export function validateAllocationDraft(
  command: ReliefAllocationCommand,
  positiveShortageItemIds: readonly string[],
): readonly AllocationDraftIssue[] {
  const issues: AllocationDraftIssue[] = [];
  const itemIds = new Set<string>();
  let totalAllocateQty = 0;

  for (const item of command.items) {
    if (!Number.isSafeInteger(item.allocateQty) || item.allocateQty < 0) {
      issues.push({ code: "INVALID_QUANTITY", requestItemId: item.requestItemId });
    } else {
      totalAllocateQty += item.allocateQty;
      if (!Number.isSafeInteger(totalAllocateQty)) {
        issues.push({ code: "INVALID_QUANTITY", requestItemId: item.requestItemId });
      }
    }

    if (itemIds.has(item.requestItemId)) {
      issues.push({ code: "DUPLICATE_ALLOCATION_ITEM", requestItemId: item.requestItemId });
    }
    itemIds.add(item.requestItemId);
  }

  const requiredShortages = new Set(positiveShortageItemIds);
  const selectedShortages = new Set<string>();

  for (const selection of command.shortages) {
    if (selectedShortages.has(selection.requestItemId)) {
      issues.push({
        code: "DUPLICATE_SHORTAGE_SELECTION",
        requestItemId: selection.requestItemId,
      });
    }
    selectedShortages.add(selection.requestItemId);

    if (!itemIds.has(selection.requestItemId)) {
      issues.push({ code: "UNKNOWN_SHORTAGE_ITEM", requestItemId: selection.requestItemId });
    } else if (!requiredShortages.has(selection.requestItemId)) {
      issues.push({
        code: "UNEXPECTED_PARTNER_SELECTION",
        requestItemId: selection.requestItemId,
      });
    }
  }

  for (const requestItemId of requiredShortages) {
    if (!itemIds.has(requestItemId)) {
      issues.push({ code: "UNKNOWN_SHORTAGE_ITEM", requestItemId });
    } else if (!selectedShortages.has(requestItemId)) {
      issues.push({ code: "PARTNER_REQUIRED", requestItemId });
    }
  }

  if (totalAllocateQty === 0 && requiredShortages.size === 0) {
    issues.push({ code: "ZERO_ALLOCATION_WITHOUT_RESUPPLY" });
  }

  if (command.notes !== undefined && command.notes.trim().length > 500) {
    issues.push({ code: "NOTES_TOO_LONG" });
  }

  return issues;
}

interface CanonicalAllocationIntent {
  readonly requestId: string;
  readonly items: readonly ReliefAllocationItemCommand[];
  readonly shortages: readonly {
    readonly requestItemId: string;
    readonly partnerOrganisationId: string;
  }[];
  readonly rescueTeamId: string | null;
  readonly notes: string | null;
}

export function canonicalizeAllocationIntent(
  requestId: string,
  command: ReliefAllocationCommand,
): string {
  const intent: CanonicalAllocationIntent = {
    requestId,
    items: command.items
      .map(({ requestItemId, allocateQty }) => ({ requestItemId, allocateQty }))
      .sort((left, right) => left.requestItemId.localeCompare(right.requestItemId)),
    shortages: command.shortages
      .map(({ requestItemId, partnerOrganisationId }) => ({
        requestItemId,
        partnerOrganisationId,
      }))
      .sort((left, right) => {
        const itemDifference = left.requestItemId.localeCompare(right.requestItemId);
        return itemDifference !== 0
          ? itemDifference
          : left.partnerOrganisationId.localeCompare(right.partnerOrganisationId);
      }),
    rescueTeamId: command.rescueTeamId ?? null,
    notes: command.notes?.trim() || null,
  };

  return JSON.stringify(intent);
}

export function isDispatchEligible(
  zoneSeverity: ZoneSeverityValue,
  items: readonly ReliefAllocationItemCommand[],
): boolean {
  return zoneSeverity === ZoneSeverity.CRITICAL && items.some((item) => item.allocateQty > 0);
}

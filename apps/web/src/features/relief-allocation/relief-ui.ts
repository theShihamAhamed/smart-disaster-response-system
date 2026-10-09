import { ReliefRequestStatus, type SupplyType, type ZoneSeverity } from "@disaster/domain";
import type { createReliefAllocationClient } from "@disaster/api-client";
import type {
  ReliefAllocationCommand,
  ReliefRequestDetails,
  ReliefRequestItemDetails,
} from "@disaster/shared-types";

export interface AllocationDraft {
  readonly quantities: Readonly<Record<string, string>>;
  readonly partnerIds: Readonly<Record<string, string>>;
  readonly rescueTeamId: string;
  readonly notes: string;
}

export type ReliefAllocationApi = ReturnType<typeof createReliefAllocationClient>;

export interface DraftValidation {
  readonly command: ReliefAllocationCommand | null;
  readonly quantityErrors: Readonly<Record<string, string>>;
  readonly partnerErrors: Readonly<Record<string, string>>;
  readonly notesError: string | null;
}

export function humanizeConstant(value: string): string {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

export function formatDateTime(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Unknown time";
  return new Intl.DateTimeFormat("en-LK", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function formatSupplyType(value: SupplyType): string {
  return humanizeConstant(value);
}

export function formatSeverity(value: ZoneSeverity): string {
  return humanizeConstant(value);
}

export function createInitialDraft(details: ReliefRequestDetails): AllocationDraft {
  return {
    quantities: Object.fromEntries(
      details.items
        .filter(({ outstandingQty }) => outstandingQty > 0)
        .map(({ requestItemId }) => [requestItemId, "0"]),
    ),
    partnerIds: {},
    rescueTeamId: "",
    notes: "",
  };
}

export function itemMaximum(item: ReliefRequestItemDetails): number {
  return Math.min(item.outstandingQty, item.warehouseStock.availableQty);
}

export function draftQuantity(draft: AllocationDraft, requestItemId: string): number | null {
  const value = draft.quantities[requestItemId] ?? "";
  if (!/^\d+$/.test(value)) return null;
  const quantity = Number(value);
  return Number.isSafeInteger(quantity) ? quantity : null;
}

export function previewShortage(item: ReliefRequestItemDetails, draft: AllocationDraft): number {
  const quantity = draftQuantity(draft, item.requestItemId);
  return quantity === null ? item.outstandingQty : Math.max(0, item.outstandingQty - quantity);
}

export function validateDraft(
  details: ReliefRequestDetails,
  draft: AllocationDraft,
): DraftValidation {
  const quantityErrors: Record<string, string> = {};
  const partnerErrors: Record<string, string> = {};
  const items = details.items.filter(({ outstandingQty }) => outstandingQty > 0);
  const commandItems: { requestItemId: string; allocateQty: number }[] = [];
  const shortages: { requestItemId: string; partnerOrganisationId: string }[] = [];

  for (const item of items) {
    const quantity = draftQuantity(draft, item.requestItemId);
    const maximum = itemMaximum(item);
    if (quantity === null) {
      quantityErrors[item.requestItemId] = "Enter a whole number from 0 to the available limit.";
      continue;
    }
    if (quantity > maximum) {
      quantityErrors[item.requestItemId] = `Enter no more than ${maximum} units.`;
      continue;
    }
    commandItems.push({ requestItemId: item.requestItemId, allocateQty: quantity });
    const shortage = item.outstandingQty - quantity;
    if (shortage > 0) {
      const partnerOrganisationId = draft.partnerIds[item.requestItemId];
      if (!partnerOrganisationId) {
        partnerErrors[item.requestItemId] = "Select a partner for this shortage.";
      } else {
        shortages.push({ requestItemId: item.requestItemId, partnerOrganisationId });
      }
    }
  }

  const notes = draft.notes.trim();
  const notesError = notes.length > 500 ? "Notes must be 500 characters or fewer." : null;
  if (
    items.length === 0 ||
    Object.keys(quantityErrors).length > 0 ||
    Object.keys(partnerErrors).length > 0 ||
    notesError
  ) {
    return { command: null, quantityErrors, partnerErrors, notesError };
  }

  const hasPositiveAllocation = commandItems.some(({ allocateQty }) => allocateQty > 0);
  const command: ReliefAllocationCommand = {
    requestVersion: details.requestVersion,
    items: commandItems,
    shortages,
    ...(hasPositiveAllocation && draft.rescueTeamId ? { rescueTeamId: draft.rescueTeamId } : {}),
    ...(notes ? { notes } : {}),
  };
  return { command, quantityErrors, partnerErrors, notesError };
}

export function previewRequestStatus(
  details: ReliefRequestDetails,
  command: ReliefAllocationCommand,
): ReliefRequestStatus {
  const selectedById = new Map(
    command.items.map(({ requestItemId, allocateQty }) => [requestItemId, allocateQty]),
  );
  const totalRequested = details.items.reduce((total, item) => total + item.requestedQty, 0);
  const totalAllocated = details.items.reduce(
    (total, item) =>
      total + item.previouslyAllocatedQty + (selectedById.get(item.requestItemId) ?? 0),
    0,
  );
  if (totalAllocated === totalRequested) return ReliefRequestStatus.ALLOCATED;
  if (totalAllocated > 0) return ReliefRequestStatus.PARTIALLY_ALLOCATED;
  return ReliefRequestStatus.AWAITING_RESUPPLY;
}

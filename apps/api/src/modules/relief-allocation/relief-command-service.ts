import { RescueTeamStatus } from "@disaster/domain";
import type {
  ReliefAllocationCommand,
  ReliefAllocationReceipt,
  ReliefAllocationReceiptLookupResponse,
} from "@disaster/shared-types";
import {
  reliefAllocationCommandSchema,
  reliefAllocationIdempotencyKeySchema,
  reliefRequestIdSchema,
} from "@disaster/shared-validation";

import { ReliefCommandError } from "./relief-command-errors.js";
import type {
  PersistedReliefAllocation,
  PreparedReliefAllocationCommand,
  ReliefAllocationCommandRepository,
  ReliefAllocationTransactionPort,
} from "./relief-command-repository.js";
import { canonicalizeAllocationIntent, validateAllocationDraft } from "./relief-rules.js";

export interface ReliefCommandActor {
  readonly officerId: string;
  readonly districtId: string;
}

export interface AllocateReliefResourcesInput {
  readonly actor: ReliefCommandActor;
  readonly requestId: string;
  readonly idempotencyKey: string;
  readonly command: ReliefAllocationCommand;
}

export type ReliefAllocationExecutionResult =
  | { readonly kind: "CREATED"; readonly receipt: ReliefAllocationReceipt }
  | { readonly kind: "REPLAYED"; readonly receipt: ReliefAllocationReceipt };

export interface ReliefCommandOperations {
  getReceiptByIdempotencyKey(
    actor: ReliefCommandActor,
    idempotencyKey: string,
  ): Promise<ReliefAllocationReceiptLookupResponse>;
  allocateReliefResources(
    input: AllocateReliefResourcesInput,
  ): Promise<ReliefAllocationExecutionResult>;
}

function integrityError(): ReliefCommandError {
  return new ReliefCommandError(
    "ALLOCATION_DATA_INTEGRITY_ERROR",
    "The committed allocation data is inconsistent and cannot be recovered safely.",
  );
}

function assertDate(value: Date): string {
  if (!Number.isFinite(value.getTime())) throw integrityError();
  return value.toISOString();
}

function reconstructPersistedCommand(record: PersistedReliefAllocation): ReliefAllocationCommand {
  const requestItemsById = new Map<string, PersistedReliefAllocation["requestItems"][number]>();
  const requestItemsBySupplyType = new Map<
    PersistedReliefAllocation["requestItems"][number]["supplyType"],
    PersistedReliefAllocation["requestItems"][number]
  >();

  for (const item of record.requestItems) {
    if (requestItemsById.has(item.id) || requestItemsBySupplyType.has(item.supplyType)) {
      throw integrityError();
    }
    requestItemsById.set(item.id, item);
    requestItemsBySupplyType.set(item.supplyType, item);
  }

  const itemQuantities = new Map<string, number>();
  for (const item of record.allocationItems) {
    const requestItem = requestItemsById.get(item.requestItemId);
    if (
      !requestItem ||
      requestItem.supplyType !== item.supplyType ||
      itemQuantities.has(item.requestItemId) ||
      !Number.isSafeInteger(item.allocatedQty) ||
      item.allocatedQty <= 0
    ) {
      throw integrityError();
    }
    itemQuantities.set(item.requestItemId, item.allocatedQty);
  }

  const shortageSelections: {
    requestItemId: string;
    partnerOrganisationId: string;
  }[] = [];
  const shortageItemIds = new Set<string>();
  for (const resupply of record.resupplyRequests) {
    const requestItem = requestItemsBySupplyType.get(resupply.supplyType);
    if (
      !requestItem ||
      shortageItemIds.has(requestItem.id) ||
      !Number.isSafeInteger(resupply.requestedQty) ||
      resupply.requestedQty <= 0 ||
      resupply.createdAt.getTime() !== record.createdAt.getTime()
    ) {
      throw integrityError();
    }
    shortageItemIds.add(requestItem.id);
    if (!itemQuantities.has(requestItem.id)) itemQuantities.set(requestItem.id, 0);
    shortageSelections.push({
      requestItemId: requestItem.id,
      partnerOrganisationId: resupply.partnerOrganisationId,
    });
  }

  if (itemQuantities.size === 0) throw integrityError();
  if (record.dispatch && record.dispatch.teamStatus !== RescueTeamStatus.EN_ROUTE) {
    throw integrityError();
  }

  return {
    requestVersion: 1,
    items: [...itemQuantities].map(([requestItemId, allocateQty]) => ({
      requestItemId,
      allocateQty,
    })),
    shortages: shortageSelections,
    ...(record.dispatch ? { rescueTeamId: record.dispatch.rescueTeamId } : {}),
    ...(record.notes === null ? {} : { notes: record.notes }),
  };
}

function reconstructReceipt(record: PersistedReliefAllocation): ReliefAllocationReceipt {
  reconstructPersistedCommand(record);
  return {
    allocationId: record.allocationId,
    requestId: record.requestId,
    requestStatus: record.requestStatus,
    items: record.allocationItems.map(({ supplyType, allocatedQty }) => ({
      supplyType,
      allocatedQty,
    })),
    resupplyRequests: record.resupplyRequests.map(({ id, supplyType, requestedQty, status }) => ({
      id,
      supplyType,
      requestedQty,
      status,
    })),
    dispatch: record.dispatch
      ? {
          id: record.dispatch.id,
          teamId: record.dispatch.rescueTeamId,
          status: RescueTeamStatus.EN_ROUTE,
        }
      : null,
    createdAt: assertDate(record.createdAt),
  };
}

function canonicalizePersistedIntent(record: PersistedReliefAllocation): string {
  return canonicalizeAllocationIntent(record.requestId, reconstructPersistedCommand(record));
}

function validatedFreshCommand(
  input: AllocateReliefResourcesInput,
): PreparedReliefAllocationCommand {
  if (!input.actor.officerId || !input.actor.districtId) {
    throw new ReliefCommandError(
      "INVALID_ALLOCATION_COMMAND",
      "A trusted District Officer context is required.",
    );
  }

  const requestId = reliefRequestIdSchema.safeParse(input.requestId);
  const idempotencyKey = reliefAllocationIdempotencyKeySchema.safeParse(input.idempotencyKey);
  const command = reliefAllocationCommandSchema.safeParse(input.command);
  if (!requestId.success || !idempotencyKey.success || !command.success) {
    throw new ReliefCommandError(
      "INVALID_ALLOCATION_COMMAND",
      "The allocation command is invalid.",
    );
  }

  const normalizedCommand: ReliefAllocationCommand = {
    requestVersion: command.data.requestVersion,
    items: command.data.items,
    shortages: command.data.shortages,
    ...(command.data.rescueTeamId === undefined ? {} : { rescueTeamId: command.data.rescueTeamId }),
    ...(command.data.notes === undefined ? {} : { notes: command.data.notes }),
  };

  const draftIssues = validateAllocationDraft(
    normalizedCommand,
    normalizedCommand.shortages.map(({ requestItemId }) => requestItemId),
  );
  if (draftIssues.length > 0) {
    throw new ReliefCommandError(
      "INVALID_ALLOCATION_COMMAND",
      "The allocation command violates relief allocation rules.",
    );
  }

  return {
    officerId: input.actor.officerId,
    districtId: input.actor.districtId,
    requestId: requestId.data,
    idempotencyKey: idempotencyKey.data,
    command: normalizedCommand,
    canonicalIntent: canonicalizeAllocationIntent(requestId.data, normalizedCommand),
  };
}

export class ReliefAllocationCommandService implements ReliefCommandOperations {
  public constructor(
    private readonly repository: ReliefAllocationCommandRepository,
    private readonly transactionPort?: ReliefAllocationTransactionPort,
  ) {}

  private async findExisting(
    officerId: string,
    idempotencyKey: string,
  ): Promise<PersistedReliefAllocation | null> {
    try {
      return await this.repository.findByOfficerAndIdempotencyKey(officerId, idempotencyKey);
    } catch {
      throw new ReliefCommandError(
        "ALLOCATION_DEPENDENCY_UNAVAILABLE",
        "Allocation recovery data is temporarily unavailable.",
      );
    }
  }

  public async getReceiptByIdempotencyKey(
    actor: ReliefCommandActor,
    idempotencyKey: string,
  ): Promise<ReliefAllocationReceiptLookupResponse> {
    const record = await this.findExisting(actor.officerId, idempotencyKey);
    if (!record) {
      throw new ReliefCommandError(
        "ALLOCATION_NOT_FOUND",
        "No committed allocation was found for this idempotency key.",
      );
    }
    if (record.officerId !== actor.officerId || record.idempotencyKey !== idempotencyKey) {
      throw integrityError();
    }
    return reconstructReceipt(record);
  }

  public async allocateReliefResources(
    input: AllocateReliefResourcesInput,
  ): Promise<ReliefAllocationExecutionResult> {
    const existing = await this.findExisting(input.actor.officerId, input.idempotencyKey);
    if (existing) {
      if (
        existing.officerId !== input.actor.officerId ||
        existing.idempotencyKey !== input.idempotencyKey
      ) {
        throw integrityError();
      }
      const incomingIntent = canonicalizeAllocationIntent(input.requestId, input.command);
      if (canonicalizePersistedIntent(existing) !== incomingIntent) {
        throw new ReliefCommandError(
          "IDEMPOTENCY_MISMATCH",
          "The idempotency key is already associated with a different allocation intent.",
        );
      }
      return { kind: "REPLAYED", receipt: reconstructReceipt(existing) };
    }

    const prepared = validatedFreshCommand(input);
    if (!this.transactionPort) {
      throw new ReliefCommandError(
        "ALLOCATION_TRANSACTION_NOT_AVAILABLE",
        "The atomic allocation transaction is not available in this milestone.",
      );
    }

    const receipt = await this.transactionPort.execute(prepared);
    return { kind: "CREATED", receipt };
  }
}

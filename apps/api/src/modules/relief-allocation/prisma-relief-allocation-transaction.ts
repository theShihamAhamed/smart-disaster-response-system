import { randomUUID } from "node:crypto";

import {
  PartnerResupplyStatus,
  Prisma,
  type PrismaClient,
  ReliefRequestStatus,
  RescueTeamStatus,
} from "@prisma/client";

import { ReliefCommandError } from "./relief-command-errors.js";
import type {
  PreparedReliefAllocationCommand,
  ReliefAllocationTransactionPort,
  ReliefAllocationTransactionResult,
} from "./relief-command-repository.js";
import {
  calculateOutstanding,
  calculateShortage,
  deriveReliefRequestStatus,
  isDispatchEligible,
  ReliefRuleError,
} from "./relief-rules.js";

const MAX_TRANSIENT_RETRIES = 2;

class IdempotencyRace extends Error {
  public constructor() {
    super("A concurrent command committed this officer/idempotency key.");
    this.name = "IdempotencyRace";
  }
}

export interface ReliefAllocationTransactionDependencies {
  readonly now?: () => Date;
  readonly createId?: () => string;
}

function commandError(
  code: ConstructorParameters<typeof ReliefCommandError>[0],
  message: string,
): ReliefCommandError {
  return new ReliefCommandError(code, message);
}

function isKnownPrismaError(error: unknown, code: string): boolean {
  return (
    (error instanceof Prisma.PrismaClientKnownRequestError && error.code === code) ||
    (typeof error === "object" && error !== null && "code" in error && error.code === code)
  );
}

function requestChanged(message = "The relief request changed before the command committed.") {
  return commandError("REQUEST_CHANGED", message);
}

export class PrismaReliefAllocationTransaction implements ReliefAllocationTransactionPort {
  private readonly now: () => Date;
  private readonly createId: () => string;

  public constructor(
    private readonly client: PrismaClient,
    dependencies: ReliefAllocationTransactionDependencies = {},
  ) {
    this.now = dependencies.now ?? (() => new Date());
    this.createId = dependencies.createId ?? randomUUID;
  }

  public async execute(
    prepared: PreparedReliefAllocationCommand,
  ): Promise<ReliefAllocationTransactionResult> {
    const commandTimestamp = this.now();
    if (!Number.isFinite(commandTimestamp.getTime())) {
      throw commandError(
        "ALLOCATION_DEPENDENCY_UNAVAILABLE",
        "The allocation transaction timestamp is unavailable.",
      );
    }

    for (let attempt = 0; attempt <= MAX_TRANSIENT_RETRIES; attempt += 1) {
      try {
        return await this.executeAttempt(prepared, commandTimestamp);
      } catch (error) {
        if (error instanceof IdempotencyRace) return { kind: "IDEMPOTENCY_RACE" };
        if (error instanceof ReliefCommandError) throw error;

        if (isKnownPrismaError(error, "P2034")) {
          if (attempt < MAX_TRANSIENT_RETRIES) continue;
          throw requestChanged(
            "The allocation conflicted with another transaction. Refresh and confirm again.",
          );
        }

        throw commandError(
          "ALLOCATION_DEPENDENCY_UNAVAILABLE",
          "The allocation transaction is temporarily unavailable.",
        );
      }
    }

    throw commandError(
      "ALLOCATION_DEPENDENCY_UNAVAILABLE",
      "The allocation transaction is temporarily unavailable.",
    );
  }

  private executeAttempt(
    prepared: PreparedReliefAllocationCommand,
    commandTimestamp: Date,
  ): Promise<ReliefAllocationTransactionResult> {
    return this.client.$transaction(
      async (transaction) => {
        const concurrentAllocation = await transaction.resourceAllocation.findUnique({
          where: {
            officerId_idempotencyKey: {
              officerId: prepared.officerId,
              idempotencyKey: prepared.idempotencyKey,
            },
          },
          select: { id: true },
        });
        if (concurrentAllocation) return { kind: "IDEMPOTENCY_RACE" } as const;

        const request = await transaction.reliefRequest.findUnique({
          where: { id: prepared.requestId },
          select: {
            status: true,
            version: true,
            shelter: {
              select: {
                districtId: true,
                locationId: true,
                location: { select: { districtId: true } },
              },
            },
            targetZone: { select: { districtId: true, severity: true } },
            items: {
              orderBy: [{ supplyType: "asc" }, { id: "asc" }],
              select: {
                id: true,
                supplyType: true,
                requestedQty: true,
                allocationItems: { select: { allocatedQty: true } },
              },
            },
          },
        });

        if (!request) {
          throw commandError("RELIEF_REQUEST_NOT_FOUND", "The relief request was not found.");
        }
        if (
          request.shelter.districtId !== prepared.districtId ||
          request.shelter.location.districtId !== prepared.districtId ||
          request.targetZone.districtId !== prepared.districtId
        ) {
          throw commandError(
            "RELIEF_REQUEST_NOT_FOUND",
            "The relief request was not found in the authenticated district.",
          );
        }
        if (request.version !== prepared.command.requestVersion) throw requestChanged();
        if (request.status === ReliefRequestStatus.ALLOCATED) {
          throw commandError(
            "REQUEST_ALREADY_ALLOCATED",
            "The relief request has already been fully allocated.",
          );
        }
        if (
          request.status !== ReliefRequestStatus.AWAITING_ALLOCATION &&
          request.status !== ReliefRequestStatus.PARTIALLY_ALLOCATED &&
          request.status !== ReliefRequestStatus.AWAITING_RESUPPLY
        ) {
          throw requestChanged();
        }

        const outstandingItems = request.items.map((item) => {
          try {
            const previousAllocatedQty = item.allocationItems.reduce(
              (total, allocationItem) => total + allocationItem.allocatedQty,
              0,
            );
            return {
              id: item.id,
              supplyType: item.supplyType,
              requestedQty: item.requestedQty,
              previousAllocatedQty,
              outstandingQty: calculateOutstanding(
                item.requestedQty,
                item.allocationItems.map(({ allocatedQty }) => allocatedQty),
              ),
            };
          } catch (error) {
            if (error instanceof ReliefRuleError) {
              throw commandError(
                "ALLOCATION_DATA_INTEGRITY_ERROR",
                "The relief request allocation history is inconsistent.",
              );
            }
            throw error;
          }
        });
        const positiveOutstandingItems = outstandingItems.filter(
          ({ outstandingQty }) => outstandingQty > 0,
        );
        if (positiveOutstandingItems.length === 0) {
          throw commandError(
            "REQUEST_ALREADY_ALLOCATED",
            "The relief request has no outstanding demand.",
          );
        }

        const commandItemsById = new Map(
          prepared.command.items.map((item) => [item.requestItemId, item] as const),
        );
        if (
          commandItemsById.size !== positiveOutstandingItems.length ||
          positiveOutstandingItems.some(({ id }) => !commandItemsById.has(id))
        ) {
          throw requestChanged(
            "The outstanding relief items changed before the command committed.",
          );
        }

        const plannedItems = positiveOutstandingItems.map((item) => {
          const commandItem = commandItemsById.get(item.id);
          if (!commandItem) throw requestChanged();
          let shortageQty: number;
          try {
            shortageQty = calculateShortage(item.outstandingQty, commandItem.allocateQty);
          } catch (error) {
            if (error instanceof ReliefRuleError) {
              throw requestChanged(
                "An allocation quantity exceeds the current outstanding demand.",
              );
            }
            throw error;
          }
          return { ...item, allocateQty: commandItem.allocateQty, shortageQty };
        });

        const shortageSelections = new Map(
          prepared.command.shortages.map(
            (selection) => [selection.requestItemId, selection.partnerOrganisationId] as const,
          ),
        );
        const shortages = plannedItems.filter(({ shortageQty }) => shortageQty > 0);
        if (
          shortageSelections.size !== shortages.length ||
          shortages.some(({ id }) => !shortageSelections.has(id))
        ) {
          throw commandError(
            "PARTNER_REQUIRED",
            "Every current shortage requires one eligible partner organisation.",
          );
        }

        const partnerIds = [...new Set(shortageSelections.values())];
        const partners = await transaction.partnerOrganisation.findMany({
          where: { id: { in: partnerIds } },
          select: { id: true, districtId: true, active: true },
        });
        const partnersById = new Map(partners.map((partner) => [partner.id, partner] as const));
        for (const partnerId of partnerIds) {
          const partner = partnersById.get(partnerId);
          if (!partner || !partner.active || partner.districtId !== prepared.districtId) {
            throw commandError(
              "PARTNER_REQUIRED",
              "A selected partner is unavailable or outside the authenticated district.",
            );
          }
        }

        for (const shortage of shortages) {
          const partnerOrganisationId = shortageSelections.get(shortage.id);
          if (!partnerOrganisationId)
            throw commandError("PARTNER_REQUIRED", "A partner is required.");
          const duplicate = await transaction.partnerResupplyRequest.findFirst({
            where: {
              reliefRequestId: prepared.requestId,
              partnerOrganisationId,
              supplyType: shortage.supplyType,
              status: PartnerResupplyStatus.REQUESTED,
            },
            select: { id: true },
          });
          if (duplicate) {
            throw requestChanged("An active partner resupply request already exists.");
          }
        }

        const positiveAllocations = plannedItems.filter(({ allocateQty }) => allocateQty > 0);
        if (prepared.command.rescueTeamId) {
          if (!isDispatchEligible(request.targetZone.severity, prepared.command.items)) {
            throw commandError(
              "TEAM_UNAVAILABLE",
              "Dispatch requires a critical target zone and a positive allocation.",
            );
          }
          const team = await transaction.rescueTeam.findUnique({
            where: { id: prepared.command.rescueTeamId },
            select: { districtId: true, status: true },
          });
          if (
            !team ||
            team.districtId !== prepared.districtId ||
            team.status !== RescueTeamStatus.AVAILABLE
          ) {
            throw commandError(
              "TEAM_UNAVAILABLE",
              "The selected rescue team is not available in the authenticated district.",
            );
          }
        }

        for (const item of positiveAllocations) {
          const stockUpdate = await transaction.warehouseStock.updateMany({
            where: {
              districtId: prepared.districtId,
              supplyType: item.supplyType,
              availableQty: { gte: item.allocateQty },
            },
            data: {
              availableQty: { decrement: item.allocateQty },
              version: { increment: 1 },
            },
          });
          if (stockUpdate.count !== 1) {
            throw commandError(
              "STOCK_CHANGED",
              "Warehouse stock changed before the allocation could commit.",
            );
          }
        }

        const allocationId = this.createId();
        try {
          await transaction.resourceAllocation.create({
            data: {
              id: allocationId,
              requestId: prepared.requestId,
              officerId: prepared.officerId,
              idempotencyKey: prepared.idempotencyKey,
              notes: prepared.command.notes?.trim() || null,
              createdAt: commandTimestamp,
            },
            select: { id: true },
          });
        } catch (error) {
          if (isKnownPrismaError(error, "P2002")) throw new IdempotencyRace();
          throw error;
        }

        for (const item of positiveAllocations) {
          const allocationItemId = this.createId();
          await transaction.allocationItem.create({
            data: {
              id: allocationItemId,
              allocationId,
              requestItemId: item.id,
              supplyType: item.supplyType,
              allocatedQty: item.allocateQty,
            },
            select: { id: true },
          });
          await transaction.distributionLog.create({
            data: {
              id: this.createId(),
              allocationId,
              allocationItemId,
              districtId: prepared.districtId,
              supplyType: item.supplyType,
              quantity: item.allocateQty,
              createdAt: commandTimestamp,
            },
            select: { id: true },
          });
        }

        for (const shortage of shortages) {
          const partnerOrganisationId = shortageSelections.get(shortage.id);
          if (!partnerOrganisationId)
            throw commandError("PARTNER_REQUIRED", "A partner is required.");
          try {
            await transaction.partnerResupplyRequest.create({
              data: {
                id: this.createId(),
                reliefRequestId: prepared.requestId,
                partnerOrganisationId,
                supplyType: shortage.supplyType,
                requestedQty: shortage.shortageQty,
                status: PartnerResupplyStatus.REQUESTED,
                createdAt: commandTimestamp,
              },
              select: { id: true },
            });
          } catch (error) {
            if (isKnownPrismaError(error, "P2002")) {
              throw requestChanged("An active partner resupply request already exists.");
            }
            throw error;
          }
        }

        if (prepared.command.rescueTeamId) {
          const teamUpdate = await transaction.rescueTeam.updateMany({
            where: {
              id: prepared.command.rescueTeamId,
              districtId: prepared.districtId,
              status: RescueTeamStatus.AVAILABLE,
            },
            data: { status: RescueTeamStatus.EN_ROUTE, version: { increment: 1 } },
          });
          if (teamUpdate.count !== 1) {
            throw commandError(
              "TEAM_UNAVAILABLE",
              "The selected rescue team is no longer available.",
            );
          }
          await transaction.transportDispatch.create({
            data: {
              id: this.createId(),
              allocationId,
              rescueTeamId: prepared.command.rescueTeamId,
              destinationLocationId: request.shelter.locationId,
              dispatchedAt: commandTimestamp,
            },
            select: { id: true },
          });
        }

        const totalRequestedQty = outstandingItems.reduce(
          (total, item) => total + item.requestedQty,
          0,
        );
        const totalAllocatedQty = outstandingItems.reduce(
          (total, item) =>
            total + item.previousAllocatedQty + (commandItemsById.get(item.id)?.allocateQty ?? 0),
          0,
        );
        let finalStatus: ReliefRequestStatus;
        try {
          finalStatus = deriveReliefRequestStatus({
            totalRequestedQty,
            totalAllocatedQty,
            hasActiveResupply: shortages.length > 0,
          });
        } catch (error) {
          if (error instanceof ReliefRuleError) {
            throw commandError(
              "ALLOCATION_DATA_INTEGRITY_ERROR",
              "The relief request totals are inconsistent.",
            );
          }
          throw error;
        }

        const requestUpdate = await transaction.reliefRequest.updateMany({
          where: {
            id: prepared.requestId,
            version: request.version,
            status: request.status,
          },
          data: { status: finalStatus, version: { increment: 1 } },
        });
        if (requestUpdate.count !== 1) throw requestChanged();

        return { kind: "COMMITTED" } as const;
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 10_000,
        timeout: 60_000,
      },
    );
  }
}

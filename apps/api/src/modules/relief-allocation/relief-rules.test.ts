import { ReliefRequestStatus, ZoneSeverity } from "@disaster/domain";
import type { ReliefAllocationCommand } from "@disaster/shared-types";
import { describe, expect, it } from "vitest";

import {
  calculateOutstanding,
  calculateShortage,
  canonicalizeAllocationIntent,
  deriveReliefRequestStatus,
  isDispatchEligible,
  rankReliefRequests,
  validateAllocationDraft,
  type RankableReliefRequest,
  type ReliefRuleError,
} from "./relief-rules.js";

function allocationCommand(): ReliefAllocationCommand {
  return {
    requestVersion: 4,
    items: [
      { requestItemId: "item-b", allocateQty: 8 },
      { requestItemId: "item-a", allocateQty: 100 },
    ],
    shortages: [
      { requestItemId: "item-b", partnerOrganisationId: "partner-b" },
      { requestItemId: "item-a", partnerOrganisationId: "partner-a" },
    ],
    rescueTeamId: "team-a",
    notes: "  Medical kits partially allocated.  ",
  };
}

function rankable(
  requestId: string,
  zoneSeverity: RankableReliefRequest["zoneSeverity"],
  currentOccupancy: number,
  capacity: number,
  createdAt: string,
): RankableReliefRequest {
  return { requestId, zoneSeverity, currentOccupancy, capacity, createdAt };
}

describe("relief quantity rules", () => {
  it("calculates outstanding demand with no previous allocation", () => {
    expect(calculateOutstanding(100, [])).toBe(100);
  });

  it("calculates outstanding demand after a partial previous allocation", () => {
    expect(calculateOutstanding(100, [20, 30])).toBe(50);
  });

  it("returns zero after complete fulfilment", () => {
    expect(calculateOutstanding(100, [40, 60])).toBe(0);
  });

  it("rejects impossible previous over-allocation", () => {
    expect(() => calculateOutstanding(100, [60, 41])).toThrowError(
      expect.objectContaining<Partial<ReliefRuleError>>({ code: "OVER_ALLOCATION" }),
    );
  });

  it.each([
    { requestedQty: 0, previous: [] },
    { requestedQty: 10, previous: [-1] },
    { requestedQty: 10, previous: [1.5] },
  ])("rejects invalid requested or previous quantity", ({ requestedQty, previous }) => {
    expect(() => calculateOutstanding(requestedQty, previous)).toThrowError(
      expect.objectContaining<Partial<ReliefRuleError>>({ code: "INVALID_QUANTITY" }),
    );
  });

  it.each([
    { outstandingQty: 20, allocateQty: 20, expected: 0 },
    { outstandingQty: 20, allocateQty: 8, expected: 12 },
    { outstandingQty: 20, allocateQty: 0, expected: 20 },
  ])("calculates exact shortage for $allocateQty of $outstandingQty", (example) => {
    expect(calculateShortage(example.outstandingQty, example.allocateQty)).toBe(example.expected);
  });

  it("rejects an allocation greater than outstanding demand", () => {
    expect(() => calculateShortage(20, 21)).toThrowError(
      expect.objectContaining<Partial<ReliefRuleError>>({ code: "OVER_ALLOCATION" }),
    );
  });
});

describe("relief request status derivation", () => {
  it("derives ALLOCATED after complete fulfilment", () => {
    expect(
      deriveReliefRequestStatus({
        totalRequestedQty: 100,
        totalAllocatedQty: 100,
        hasActiveResupply: false,
      }),
    ).toBe(ReliefRequestStatus.ALLOCATED);
  });

  it("derives PARTIALLY_ALLOCATED when allocation exists and demand remains", () => {
    expect(
      deriveReliefRequestStatus({
        totalRequestedQty: 100,
        totalAllocatedQty: 40,
        hasActiveResupply: true,
      }),
    ).toBe(ReliefRequestStatus.PARTIALLY_ALLOCATED);
  });

  it("derives AWAITING_RESUPPLY when no stock was allocated and resupply exists", () => {
    expect(
      deriveReliefRequestStatus({
        totalRequestedQty: 100,
        totalAllocatedQty: 0,
        hasActiveResupply: true,
      }),
    ).toBe(ReliefRequestStatus.AWAITING_RESUPPLY);
  });

  it("keeps an untouched request awaiting allocation", () => {
    expect(
      deriveReliefRequestStatus({
        totalRequestedQty: 100,
        totalAllocatedQty: 0,
        hasActiveResupply: false,
      }),
    ).toBe(ReliefRequestStatus.AWAITING_ALLOCATION);
  });

  it("rejects impossible cumulative totals", () => {
    expect(() =>
      deriveReliefRequestStatus({
        totalRequestedQty: 100,
        totalAllocatedQty: 101,
        hasActiveResupply: false,
      }),
    ).toThrowError(expect.objectContaining<Partial<ReliefRuleError>>({ code: "OVER_ALLOCATION" }));
  });
});

describe("relief request ranking", () => {
  it("orders severity CRITICAL, HIGH, MODERATE, LOW", () => {
    const requests = [
      rankable("low", ZoneSeverity.LOW, 10, 100, "2026-10-01T00:00:00Z"),
      rankable("critical", ZoneSeverity.CRITICAL, 10, 100, "2026-10-01T00:00:00Z"),
      rankable("moderate", ZoneSeverity.MODERATE, 10, 100, "2026-10-01T00:00:00Z"),
      rankable("high", ZoneSeverity.HIGH, 10, 100, "2026-10-01T00:00:00Z"),
    ];

    expect(rankReliefRequests(requests).map(({ requestId }) => requestId)).toEqual([
      "critical",
      "high",
      "moderate",
      "low",
    ]);
  });

  it("uses occupancy rate descending after severity", () => {
    const requests = [
      rankable("half", ZoneSeverity.HIGH, 50, 100, "2026-10-01T00:00:00Z"),
      rankable("three-quarters", ZoneSeverity.HIGH, 150, 200, "2026-10-01T00:00:00Z"),
    ];

    expect(rankReliefRequests(requests).map(({ requestId }) => requestId)).toEqual([
      "three-quarters",
      "half",
    ]);
  });

  it("uses oldest request first after severity and occupancy", () => {
    const requests = [
      rankable("newer", ZoneSeverity.HIGH, 50, 100, "2026-10-02T00:00:00Z"),
      rankable("older", ZoneSeverity.HIGH, 50, 100, "2026-10-01T00:00:00Z"),
    ];

    expect(rankReliefRequests(requests).map(({ requestId }) => requestId)).toEqual([
      "older",
      "newer",
    ]);
  });

  it("uses request ID as a deterministic complete tie-breaker", () => {
    const requests = [
      rankable("request-z", ZoneSeverity.HIGH, 50, 100, "2026-10-01T00:00:00Z"),
      rankable("request-a", ZoneSeverity.HIGH, 50, 100, "2026-10-01T00:00:00Z"),
    ];

    expect(rankReliefRequests(requests).map(({ requestId }) => requestId)).toEqual([
      "request-a",
      "request-z",
    ]);
  });

  it("rejects invalid capacity and creation time inputs", () => {
    expect(() =>
      rankReliefRequests([
        rankable("bad-capacity", ZoneSeverity.HIGH, 50, 0, "2026-10-01T00:00:00Z"),
      ]),
    ).toThrowError(expect.objectContaining<Partial<ReliefRuleError>>({ code: "INVALID_CAPACITY" }));

    expect(() =>
      rankReliefRequests([rankable("bad-date", ZoneSeverity.HIGH, 50, 100, "not-a-date")]),
    ).toThrowError(
      expect.objectContaining<Partial<ReliefRuleError>>({ code: "INVALID_CREATED_AT" }),
    );
  });
});

describe("allocation draft validation", () => {
  it("accepts a valid draft with partner selections for all positive shortages", () => {
    expect(validateAllocationDraft(allocationCommand(), ["item-a", "item-b"])).toEqual([]);
  });

  it("reports missing, duplicate and unexpected partner selections", () => {
    const command: ReliefAllocationCommand = {
      ...allocationCommand(),
      shortages: [
        { requestItemId: "item-a", partnerOrganisationId: "partner-a" },
        { requestItemId: "item-a", partnerOrganisationId: "partner-b" },
      ],
    };

    expect(validateAllocationDraft(command, ["item-b"]).map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        "DUPLICATE_SHORTAGE_SELECTION",
        "UNEXPECTED_PARTNER_SELECTION",
        "PARTNER_REQUIRED",
      ]),
    );
  });

  it("rejects an all-zero draft without a resupply requirement", () => {
    const command: ReliefAllocationCommand = {
      requestVersion: 1,
      items: [{ requestItemId: "item-a", allocateQty: 0 }],
      shortages: [],
    };

    expect(validateAllocationDraft(command, [])).toContainEqual({
      code: "ZERO_ALLOCATION_WITHOUT_RESUPPLY",
    });
  });

  it("reports invalid quantities, duplicate items, unknown shortages and long notes", () => {
    const command: ReliefAllocationCommand = {
      requestVersion: 1,
      items: [
        { requestItemId: "item-a", allocateQty: -1 },
        { requestItemId: "item-a", allocateQty: Number.MAX_SAFE_INTEGER },
        { requestItemId: "item-b", allocateQty: Number.MAX_SAFE_INTEGER },
      ],
      shortages: [{ requestItemId: "item-unknown", partnerOrganisationId: "partner-a" }],
      notes: "x".repeat(501),
    };

    expect(validateAllocationDraft(command, ["item-missing"]).map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        "INVALID_QUANTITY",
        "DUPLICATE_ALLOCATION_ITEM",
        "UNKNOWN_SHORTAGE_ITEM",
        "NOTES_TOO_LONG",
      ]),
    );
  });
});

describe("canonical allocation intent", () => {
  it("is stable across item and partner-selection array order", () => {
    const original = allocationCommand();
    const reordered: ReliefAllocationCommand = {
      ...original,
      items: [...original.items].reverse(),
      shortages: [...original.shortages].reverse(),
    };

    expect(canonicalizeAllocationIntent("request-a", reordered)).toBe(
      canonicalizeAllocationIntent("request-a", original),
    );
  });

  it("normalizes surrounding note whitespace", () => {
    const original = allocationCommand();
    const normalized = { ...original, notes: "Medical kits partially allocated." };

    expect(canonicalizeAllocationIntent("request-a", normalized)).toBe(
      canonicalizeAllocationIntent("request-a", original),
    );
  });

  it("excludes requestVersion and derived state from business intent", () => {
    const original = allocationCommand();
    const withDifferentPreconditionAndDerivedState = {
      ...original,
      requestVersion: 99,
      warehouseStock: [{ requestItemId: "item-a", availableQty: 2 }],
      finalStatus: ReliefRequestStatus.ALLOCATED,
      shortageQty: 0,
      items: original.items.map((item) => ({ ...item, availableQty: 500, shortageQty: 0 })),
    };

    expect(
      canonicalizeAllocationIntent("request-a", withDifferentPreconditionAndDerivedState),
    ).toBe(canonicalizeAllocationIntent("request-a", original));
  });

  it.each([
    {
      label: "allocation quantity",
      change: (command: ReliefAllocationCommand): ReliefAllocationCommand => ({
        ...command,
        items: [{ ...command.items[0]!, allocateQty: 7 }, command.items[1]!],
      }),
    },
    {
      label: "partner",
      change: (command: ReliefAllocationCommand): ReliefAllocationCommand => ({
        ...command,
        shortages: [
          { ...command.shortages[0]!, partnerOrganisationId: "partner-changed" },
          command.shortages[1]!,
        ],
      }),
    },
    {
      label: "rescue team",
      change: (command: ReliefAllocationCommand): ReliefAllocationCommand => ({
        ...command,
        rescueTeamId: "team-changed",
      }),
    },
  ])("changes when the $label business choice changes", ({ change }) => {
    const original = allocationCommand();

    expect(canonicalizeAllocationIntent("request-a", change(original))).not.toBe(
      canonicalizeAllocationIntent("request-a", original),
    );
  });
});

describe("dispatch eligibility", () => {
  it("allows CRITICAL-zone dispatch with a positive allocation", () => {
    expect(isDispatchEligible(ZoneSeverity.CRITICAL, allocationCommand().items)).toBe(true);
  });

  it("rejects dispatch for a non-critical zone", () => {
    expect(isDispatchEligible(ZoneSeverity.HIGH, allocationCommand().items)).toBe(false);
  });

  it("rejects dispatch when every allocation quantity is zero", () => {
    expect(
      isDispatchEligible(ZoneSeverity.CRITICAL, [
        { requestItemId: "item-a", allocateQty: 0 },
        { requestItemId: "item-b", allocateQty: 0 },
      ]),
    ).toBe(false);
  });
});

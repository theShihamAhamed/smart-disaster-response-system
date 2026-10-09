import { describe, expect, it } from "vitest";

import {
  reliefAllocationCommandSchema,
  reliefAllocationHeadersSchema,
  reliefAllocationIdempotencyKeySchema,
  reliefAllocationLookupPathParamsSchema,
  reliefRequestPathParamsSchema,
  reliefRequestQueueQuerySchema,
} from "./relief";

const ITEM_ONE = "11111111-1111-4111-8111-111111111111";
const ITEM_TWO = "22222222-2222-4222-8222-222222222222";
const PARTNER_ONE = "33333333-3333-4333-8333-333333333333";
const TEAM_ONE = "44444444-4444-4444-8444-444444444444";
const IDEMPOTENCY_KEY = "55555555-5555-4555-8555-555555555555";

function validCommand() {
  return {
    requestVersion: 4,
    items: [
      { requestItemId: ITEM_ONE, allocateQty: 100 },
      { requestItemId: ITEM_TWO, allocateQty: 0 },
    ],
    shortages: [{ requestItemId: ITEM_TWO, partnerOrganisationId: PARTNER_ONE }],
    rescueTeamId: TEAM_ONE,
    notes: "  Partial allocation  ",
  };
}

describe("relief allocation validation", () => {
  it("accepts and normalizes a valid allocation command with an optional rescue team", () => {
    expect(reliefAllocationCommandSchema.parse(validCommand())).toEqual({
      ...validCommand(),
      notes: "Partial allocation",
    });
  });

  it("rejects negative allocation quantities", () => {
    const command = validCommand();
    command.items[0]!.allocateQty = -1;

    expect(reliefAllocationCommandSchema.safeParse(command).success).toBe(false);
  });

  it("rejects fractional allocation quantities", () => {
    const command = validCommand();
    command.items[0]!.allocateQty = 1.5;

    expect(reliefAllocationCommandSchema.safeParse(command).success).toBe(false);
  });

  it.each([Number.POSITIVE_INFINITY, Number.NaN, Number.MAX_SAFE_INTEGER + 1])(
    "rejects unsafe or non-finite quantity %s",
    (allocateQty) => {
      const command = validCommand();
      command.items[0]!.allocateQty = allocateQty;

      expect(reliefAllocationCommandSchema.safeParse(command).success).toBe(false);
    },
  );

  it("rejects malformed request and request-item UUIDs", () => {
    const command = validCommand();
    command.items[0]!.requestItemId = "not-a-uuid";

    expect(reliefAllocationCommandSchema.safeParse(command).success).toBe(false);
    expect(reliefRequestPathParamsSchema.safeParse({ requestId: "not-a-uuid" }).success).toBe(
      false,
    );
  });

  it("rejects malformed partner and rescue-team UUIDs", () => {
    const command = validCommand();
    command.shortages[0]!.partnerOrganisationId = "not-a-uuid";
    command.rescueTeamId = "not-a-uuid";

    expect(reliefAllocationCommandSchema.safeParse(command).success).toBe(false);
  });

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid requestVersion %s",
    (requestVersion) => {
      expect(
        reliefAllocationCommandSchema.safeParse({ ...validCommand(), requestVersion }).success,
      ).toBe(false);
    },
  );

  it("rejects malformed idempotency keys", () => {
    expect(reliefAllocationIdempotencyKeySchema.safeParse("not-a-uuid").success).toBe(false);
    expect(reliefAllocationLookupPathParamsSchema.safeParse({ key: "not-a-uuid" }).success).toBe(
      false,
    );
    expect(
      reliefAllocationHeadersSchema.safeParse({ "idempotency-key": "not-a-uuid" }).success,
    ).toBe(false);
    expect(reliefAllocationIdempotencyKeySchema.parse(IDEMPOTENCY_KEY)).toBe(IDEMPOTENCY_KEY);
    expect(reliefAllocationHeadersSchema.parse({ "idempotency-key": IDEMPOTENCY_KEY })).toEqual({
      "idempotency-key": IDEMPOTENCY_KEY,
    });
  });

  it("rejects duplicate allocation request-item IDs", () => {
    const command = validCommand();
    command.items[1]!.requestItemId = ITEM_ONE;

    expect(reliefAllocationCommandSchema.safeParse(command).success).toBe(false);
  });

  it("rejects duplicate shortage request-item entries", () => {
    const command = validCommand();
    command.shortages.push({ requestItemId: ITEM_TWO, partnerOrganisationId: PARTNER_ONE });

    expect(reliefAllocationCommandSchema.safeParse(command).success).toBe(false);
  });

  it("rejects notes longer than 500 characters", () => {
    expect(
      reliefAllocationCommandSchema.safeParse({ ...validCommand(), notes: "x".repeat(501) })
        .success,
    ).toBe(false);
  });

  it("rejects invalid queue-filter enum values", () => {
    expect(
      reliefRequestQueueQuerySchema.safeParse({ status: "PENDING", zoneSeverity: "EXTREME" })
        .success,
    ).toBe(false);
    expect(
      reliefRequestQueueQuerySchema.parse({
        status: "AWAITING_ALLOCATION",
        zoneSeverity: "CRITICAL",
      }),
    ).toEqual({ status: "AWAITING_ALLOCATION", zoneSeverity: "CRITICAL" });
  });

  it("rejects client-controlled derived or authorization fields", () => {
    expect(
      reliefAllocationCommandSchema.safeParse({
        ...validCommand(),
        officerId: ITEM_ONE,
        districtId: ITEM_TWO,
        finalStatus: "ALLOCATED",
      }).success,
    ).toBe(false);
  });
});

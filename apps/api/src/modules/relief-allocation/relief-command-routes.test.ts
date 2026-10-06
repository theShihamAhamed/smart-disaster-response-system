import { ReliefRequestStatus, SupplyType, UserRole } from "@disaster/domain";
import type { ReliefAllocationReceipt } from "@disaster/shared-types";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createApp } from "../../app.js";
import {
  DEVELOPMENT_USER_HEADER,
  type DevelopmentAuthUser,
  type ResolveDevelopmentAuthUser,
} from "../../development-auth.js";
import { ReliefCommandError } from "./relief-command-errors.js";
import type { ReliefCommandOperations } from "./relief-command-service.js";

const ids = {
  district: "00000000-0000-4000-8000-000000000001",
  otherDistrict: "00000000-0000-4000-8000-000000000002",
  districtOfficer: "10000000-0000-4000-8000-000000000001",
  otherOfficer: "10000000-0000-4000-8000-000000000002",
  dmcOfficer: "10000000-0000-4000-8000-000000000003",
  key: "20000000-0000-4000-8000-000000000001",
  request: "70000000-0000-4000-8000-000000000001",
} as const;

const users: Readonly<Record<string, DevelopmentAuthUser>> = {
  [ids.districtOfficer]: {
    id: ids.districtOfficer,
    role: UserRole.DISTRICT_OFFICER,
    volunteer: null,
    dmcOfficer: null,
    districtOfficer: { districtId: ids.district },
  },
  [ids.otherOfficer]: {
    id: ids.otherOfficer,
    role: UserRole.DISTRICT_OFFICER,
    volunteer: null,
    dmcOfficer: null,
    districtOfficer: { districtId: ids.otherDistrict },
  },
  [ids.dmcOfficer]: {
    id: ids.dmcOfficer,
    role: UserRole.DMC_DUTY_OFFICER,
    volunteer: null,
    dmcOfficer: { canBroadcast: true },
    districtOfficer: null,
  },
};

const resolveUser: ResolveDevelopmentAuthUser = async (userId) => users[userId] ?? null;

const storedReceipt: ReliefAllocationReceipt = {
  allocationId: "30000000-0000-4000-8000-000000000001",
  requestId: ids.request,
  requestStatus: ReliefRequestStatus.PARTIALLY_ALLOCATED,
  items: [{ supplyType: SupplyType.WATER, allocatedQty: 40 }],
  resupplyRequests: [],
  dispatch: null,
  createdAt: "2026-09-25T12:00:00.000Z",
};

function service(overrides: Partial<ReliefCommandOperations> = {}) {
  return {
    getReceiptByIdempotencyKey: vi.fn<ReliefCommandOperations["getReceiptByIdempotencyKey"]>(
      async () => storedReceipt,
    ),
    allocateReliefResources: vi.fn<ReliefCommandOperations["allocateReliefResources"]>(
      async () => ({
        kind: "CREATED",
        receipt: storedReceipt,
      }),
    ),
    ...overrides,
  };
}

function testApp(reliefCommandService: ReliefCommandOperations = service()) {
  return createApp({ resolveDevelopmentAuthUser: resolveUser, reliefCommandService });
}

beforeEach(() => {
  vi.stubEnv("DEV_AUTH_ENABLED", "true");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("allocation idempotency recovery route", () => {
  it("requires authentication", async () => {
    const response = await request(testApp()).get(
      `/api/v1/allocations/by-idempotency-key/${ids.key}`,
    );

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("UNAUTHENTICATED");
  });

  it("forbids a non-District Officer", async () => {
    const response = await request(testApp())
      .get(`/api/v1/allocations/by-idempotency-key/${ids.key}`)
      .set(DEVELOPMENT_USER_HEADER, ids.dmcOfficer);

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("FORBIDDEN");
  });

  it("returns the owning District Officer's authoritative receipt", async () => {
    const commandService = service();
    const response = await request(testApp(commandService))
      .get(`/api/v1/allocations/by-idempotency-key/${ids.key}`)
      .set(DEVELOPMENT_USER_HEADER, ids.districtOfficer);

    expect(response.status).toBe(200);
    expect(response.body).toEqual(storedReceipt);
    expect(commandService.getReceiptByIdempotencyKey).toHaveBeenCalledWith(
      { officerId: ids.districtOfficer, districtId: ids.district },
      ids.key,
    );
  });

  it("rejects a malformed idempotency key", async () => {
    const response = await request(testApp())
      .get("/api/v1/allocations/by-idempotency-key/not-a-uuid")
      .set(DEVELOPMENT_USER_HEADER, ids.districtOfficer);

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("does not disclose a key belonging to another officer", async () => {
    const commandService = service({
      getReceiptByIdempotencyKey: vi.fn(async () => {
        throw new ReliefCommandError(
          "ALLOCATION_NOT_FOUND",
          "No committed allocation was found for this idempotency key.",
        );
      }),
    });
    const response = await request(testApp(commandService))
      .get(`/api/v1/allocations/by-idempotency-key/${ids.key}`)
      .set(DEVELOPMENT_USER_HEADER, ids.otherOfficer);

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("ALLOCATION_NOT_FOUND");
  });

  it("ignores spoofed officer and district headers", async () => {
    const commandService = service();
    const response = await request(testApp(commandService))
      .get(`/api/v1/allocations/by-idempotency-key/${ids.key}`)
      .set(DEVELOPMENT_USER_HEADER, ids.districtOfficer)
      .set("X-Officer-Id", ids.otherOfficer)
      .set("X-District-Id", ids.otherDistrict)
      .set("X-User-Role", UserRole.DMC_DUTY_OFFICER);

    expect(response.status).toBe(200);
    expect(commandService.getReceiptByIdempotencyKey).toHaveBeenCalledWith(
      { officerId: ids.districtOfficer, districtId: ids.district },
      ids.key,
    );
  });

  it.each([
    ["ALLOCATION_DATA_INTEGRITY_ERROR", 409],
    ["ALLOCATION_DEPENDENCY_UNAVAILABLE", 503],
  ] as const)("maps %s through the central envelope", async (code, status) => {
    const commandService = service({
      getReceiptByIdempotencyKey: vi.fn(async () => {
        throw new ReliefCommandError(code, "Safe recovery error.");
      }),
    });
    const response = await request(testApp(commandService))
      .get(`/api/v1/allocations/by-idempotency-key/${ids.key}`)
      .set(DEVELOPMENT_USER_HEADER, ids.districtOfficer);

    expect(response.status).toBe(status);
    expect(response.body.error).toEqual({
      code,
      message: "Safe recovery error.",
      fieldErrors: {},
      details: {},
    });
  });

  it("keeps the incomplete allocation POST route unmounted", async () => {
    const commandService = service();
    const response = await request(testApp(commandService))
      .post(`/api/v1/relief-requests/${ids.request}/allocations`)
      .set(DEVELOPMENT_USER_HEADER, ids.districtOfficer)
      .send({});

    expect(response.status).toBe(404);
    expect(commandService.allocateReliefResources).not.toHaveBeenCalled();
  });
});

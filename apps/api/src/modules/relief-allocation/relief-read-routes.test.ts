import { ReliefRequestStatus, UserRole, ZoneSeverity } from "@disaster/domain";
import type { ReliefRequestDetails, ReliefRequestQueueResponse } from "@disaster/shared-types";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createApp } from "../../app.js";
import {
  DEVELOPMENT_USER_HEADER,
  type DevelopmentAuthUser,
  type ResolveDevelopmentAuthUser,
} from "../../development-auth.js";
import { ReliefReadError } from "./relief-read-errors.js";
import type { ReliefReadOperations } from "./relief-read-service.js";

const ids = {
  district: "00000000-0000-4000-8000-000000000001",
  otherDistrict: "00000000-0000-4000-8000-000000000002",
  districtOfficer: "10000000-0000-4000-8000-000000000001",
  dmcOfficer: "10000000-0000-4000-8000-000000000002",
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
  [ids.dmcOfficer]: {
    id: ids.dmcOfficer,
    role: UserRole.DMC_DUTY_OFFICER,
    volunteer: null,
    dmcOfficer: { canBroadcast: true },
    districtOfficer: null,
  },
};

const resolveUser: ResolveDevelopmentAuthUser = async (userId) => users[userId] ?? null;

const queueResponse: ReliefRequestQueueResponse = [];
const detailsResponse: ReliefRequestDetails = {
  requestId: ids.request,
  requestVersion: 1,
  status: ReliefRequestStatus.AWAITING_ALLOCATION,
  priorityNote: null,
  createdAt: "2026-09-25T10:00:00.000Z",
  shelter: {
    id: "60000000-0000-4000-8000-000000000001",
    name: "Shelter",
    capacity: 100,
    currentOccupancy: 50,
    occupancyRate: 0.5,
    location: { latitude: 6.9, longitude: 79.8, address: null },
  },
  targetZone: {
    id: "30000000-0000-4000-8000-000000000001",
    name: "Zone",
    severity: ZoneSeverity.HIGH,
  },
  items: [],
  previousAllocations: [],
  eligiblePartners: [],
  availableRescueTeams: [],
};

function service(overrides: Partial<ReliefReadOperations> = {}) {
  return {
    listRankedRequests: vi.fn<ReliefReadOperations["listRankedRequests"]>(
      async () => queueResponse,
    ),
    getRequestDetails: vi.fn<ReliefReadOperations["getRequestDetails"]>(
      async () => detailsResponse,
    ),
    ...overrides,
  };
}

function testApp(reliefReadService: ReliefReadOperations = service()) {
  return createApp({ resolveDevelopmentAuthUser: resolveUser, reliefReadService });
}

beforeEach(() => {
  vi.stubEnv("DEV_AUTH_ENABLED", "true");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("relief read routes", () => {
  it("requires an authenticated identity", async () => {
    const response = await request(testApp()).get("/api/v1/relief-requests");

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("UNAUTHENTICATED");
  });

  it("forbids a non-District Officer", async () => {
    const response = await request(testApp())
      .get("/api/v1/relief-requests")
      .set(DEVELOPMENT_USER_HEADER, ids.dmcOfficer);

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("FORBIDDEN");
  });

  it("returns the ranked queue for a District Officer", async () => {
    const readService = service();
    const response = await request(testApp(readService))
      .get("/api/v1/relief-requests?status=AWAITING_ALLOCATION&zoneSeverity=CRITICAL")
      .set(DEVELOPMENT_USER_HEADER, ids.districtOfficer);

    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
    expect(readService.listRankedRequests).toHaveBeenCalledWith(
      { officerId: ids.districtOfficer, districtId: ids.district },
      {
        status: ReliefRequestStatus.AWAITING_ALLOCATION,
        zoneSeverity: ZoneSeverity.CRITICAL,
      },
    );
  });

  it("returns request details for a valid request UUID", async () => {
    const readService = service();
    const response = await request(testApp(readService))
      .get(`/api/v1/relief-requests/${ids.request}`)
      .set(DEVELOPMENT_USER_HEADER, ids.districtOfficer);

    expect(response.status).toBe(200);
    expect(response.body.requestId).toBe(ids.request);
    expect(readService.getRequestDetails).toHaveBeenCalledWith(
      { officerId: ids.districtOfficer, districtId: ids.district },
      ids.request,
    );
  });

  it.each([
    ["malformed request UUID", "/api/v1/relief-requests/not-a-uuid"],
    ["invalid status", "/api/v1/relief-requests?status=OPEN"],
    ["invalid severity", "/api/v1/relief-requests?zoneSeverity=EXTREME"],
    ["untrusted district query", `/api/v1/relief-requests?districtId=${ids.otherDistrict}`],
  ])("maps %s to validation error", async (_label, url) => {
    const response = await request(testApp())
      .get(url)
      .set(DEVELOPMENT_USER_HEADER, ids.districtOfficer);

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("ignores untrusted district and role headers", async () => {
    const readService = service();
    const response = await request(testApp(readService))
      .get("/api/v1/relief-requests")
      .set(DEVELOPMENT_USER_HEADER, ids.districtOfficer)
      .set("X-District-Id", ids.otherDistrict)
      .set("X-User-Role", UserRole.DMC_DUTY_OFFICER);

    expect(response.status).toBe(200);
    expect(readService.listRankedRequests).toHaveBeenCalledWith(
      { officerId: ids.districtOfficer, districtId: ids.district },
      {},
    );
  });

  it.each([
    ["RELIEF_REQUEST_NOT_FOUND", 404],
    ["RELIEF_DATA_INTEGRITY_ERROR", 409],
    ["STOCK_LEDGER_UNAVAILABLE", 503],
    ["RELIEF_READ_UNAVAILABLE", 503],
  ] as const)("maps %s through the central error envelope", async (code, status) => {
    const readService = service({
      getRequestDetails: vi.fn(async () => {
        throw new ReliefReadError(code, "Safe relief read error.");
      }),
    });
    const response = await request(testApp(readService))
      .get(`/api/v1/relief-requests/${ids.request}`)
      .set(DEVELOPMENT_USER_HEADER, ids.districtOfficer);

    expect(response.status).toBe(status);
    expect(response.body.error).toEqual({
      code,
      message: "Safe relief read error.",
      fieldErrors: {},
      details: {},
    });
  });

  it("does not mount the allocation POST route", async () => {
    const app = testApp();
    const allocation = await request(app)
      .post(`/api/v1/relief-requests/${ids.request}/allocations`)
      .set(DEVELOPMENT_USER_HEADER, ids.districtOfficer)
      .send({});

    expect(allocation.status).toBe(404);
  });
});

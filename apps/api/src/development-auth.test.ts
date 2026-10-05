import { UserRole, type UserRole as UserRoleValue } from "@disaster/domain";
import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requireRoles } from "./authorization.js";
import { createApp } from "./app.js";
import {
  createDevelopmentAuthContext,
  DEVELOPMENT_USER_HEADER,
  type DevelopmentAuthUser,
  type ResolveDevelopmentAuthUser,
} from "./development-auth.js";
import { errorHandler } from "./errors.js";

const ids = {
  citizen: "10000000-0000-4000-8000-000000000001",
  volunteer: "10000000-0000-4000-8000-000000000002",
  dmcOfficer: "10000000-0000-4000-8000-000000000003",
  broadcaster: "10000000-0000-4000-8000-000000000004",
  districtOfficer: "10000000-0000-4000-8000-000000000005",
  unknown: "10000000-0000-4000-8000-000000000099",
  assignedArea: "00000000-0000-4000-8000-000000000002",
  district: "00000000-0000-4000-8000-000000000001",
} as const;

const users: Readonly<Record<string, DevelopmentAuthUser>> = {
  [ids.citizen]: {
    id: ids.citizen,
    role: UserRole.CITIZEN,
    volunteer: null,
    dmcOfficer: null,
    districtOfficer: null,
  },
  [ids.volunteer]: {
    id: ids.volunteer,
    role: UserRole.VOLUNTEER,
    volunteer: { assignedAreaId: ids.assignedArea },
    dmcOfficer: null,
    districtOfficer: null,
  },
  [ids.dmcOfficer]: {
    id: ids.dmcOfficer,
    role: UserRole.DMC_DUTY_OFFICER,
    volunteer: null,
    dmcOfficer: { canBroadcast: false },
    districtOfficer: null,
  },
  [ids.broadcaster]: {
    id: ids.broadcaster,
    role: UserRole.DMC_DUTY_OFFICER,
    volunteer: null,
    dmcOfficer: { canBroadcast: true },
    districtOfficer: null,
  },
  [ids.districtOfficer]: {
    id: ids.districtOfficer,
    role: UserRole.DISTRICT_OFFICER,
    volunteer: null,
    dmcOfficer: null,
    districtOfficer: { districtId: ids.district },
  },
};

const resolveUser: ResolveDevelopmentAuthUser = async (userId) => users[userId] ?? null;

function protectedApp(
  allowedRoles: readonly UserRoleValue[],
  resolver: ResolveDevelopmentAuthUser = resolveUser,
) {
  const app = express();
  app.use(express.json());
  app.use(createDevelopmentAuthContext(resolver));
  app.get("/protected", requireRoles(...allowedRoles), (_request, response) => {
    response.status(200).json(response.locals.auth);
  });
  app.use(errorHandler);
  return app;
}

beforeEach(() => {
  vi.stubEnv("DEV_AUTH_ENABLED", "true");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("development authentication context", () => {
  it("leaves a missing identity for requireRoles to reject", async () => {
    const response = await request(protectedApp([UserRole.CITIZEN])).get("/protected");

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("UNAUTHENTICATED");
  });

  it("rejects a malformed user ID", async () => {
    const response = await request(protectedApp([UserRole.CITIZEN]))
      .get("/protected")
      .set(DEVELOPMENT_USER_HEADER, "not-a-uuid");

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("UNAUTHENTICATED");
  });

  it("rejects an unknown user", async () => {
    const response = await request(protectedApp([UserRole.CITIZEN]))
      .get("/protected")
      .set(DEVELOPMENT_USER_HEADER, ids.unknown);

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("UNAUTHENTICATED");
  });

  it.each([
    [ids.citizen, { userId: ids.citizen, role: UserRole.CITIZEN }],
    [
      ids.volunteer,
      {
        userId: ids.volunteer,
        role: UserRole.VOLUNTEER,
        assignedAreaId: ids.assignedArea,
      },
    ],
    [
      ids.dmcOfficer,
      { userId: ids.dmcOfficer, role: UserRole.DMC_DUTY_OFFICER, canBroadcast: false },
    ],
    [
      ids.broadcaster,
      { userId: ids.broadcaster, role: UserRole.DMC_DUTY_OFFICER, canBroadcast: true },
    ],
    [
      ids.districtOfficer,
      {
        userId: ids.districtOfficer,
        role: UserRole.DISTRICT_OFFICER,
        districtId: ids.district,
      },
    ],
  ])(
    "derives trusted context for seeded user %s when DEV_AUTH_ENABLED=true",
    async (userId, expectedContext) => {
      const response = await request(
        protectedApp([
          UserRole.CITIZEN,
          UserRole.VOLUNTEER,
          UserRole.DMC_DUTY_OFFICER,
          UserRole.DISTRICT_OFFICER,
        ]),
      )
        .get("/protected")
        .set(DEVELOPMENT_USER_HEADER, userId);

      expect(response.status).toBe(200);
      expect(response.body).toEqual(expectedContext);
    },
  );

  it.each([UserRole.VOLUNTEER, UserRole.DMC_DUTY_OFFICER, UserRole.DISTRICT_OFFICER])(
    "fails safely when a %s role profile is missing",
    async (role) => {
      const userId = "10000000-0000-4000-8000-000000000098";
      const resolver: ResolveDevelopmentAuthUser = async () => ({
        id: userId,
        role,
        volunteer: null,
        dmcOfficer: null,
        districtOfficer: null,
      });
      const response = await request(protectedApp([role], resolver))
        .get("/protected")
        .set(DEVELOPMENT_USER_HEADER, userId);

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe("ROLE_PROFILE_REQUIRED");
    },
  );

  it("ignores client attempts to override role and officer permissions", async () => {
    const response = await request(protectedApp([UserRole.CITIZEN]))
      .get("/protected")
      .set(DEVELOPMENT_USER_HEADER, ids.citizen)
      .set("X-User-Role", UserRole.DISTRICT_OFFICER)
      .set("X-District-Id", ids.district)
      .set("X-Can-Broadcast", "true")
      .send({ role: UserRole.DMC_DUTY_OFFICER, districtId: ids.district, canBroadcast: true });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ userId: ids.citizen, role: UserRole.CITIZEN });
  });

  it("allows an authorized role and rejects a disallowed role", async () => {
    const allowed = await request(protectedApp([UserRole.DISTRICT_OFFICER]))
      .get("/protected")
      .set(DEVELOPMENT_USER_HEADER, ids.districtOfficer);
    const forbidden = await request(protectedApp([UserRole.CITIZEN]))
      .get("/protected")
      .set(DEVELOPMENT_USER_HEADER, ids.districtOfficer);

    expect(allowed.status).toBe(200);
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.error.code).toBe("FORBIDDEN");
  });

  it("maps authentication data-source failures without leaking details", async () => {
    const response = await request(
      protectedApp([UserRole.CITIZEN], async () => {
        throw new Error("database host and credentials");
      }),
    )
      .get("/protected")
      .set(DEVELOPMENT_USER_HEADER, ids.citizen);

    expect(response.status).toBe(503);
    expect(response.body.error).toEqual({
      code: "AUTH_DEPENDENCY_UNAVAILABLE",
      message: "The authentication data source is unavailable.",
      fieldErrors: {},
      details: {},
    });
    expect(JSON.stringify(response.body)).not.toContain("database host");
  });

  it.each(["false", undefined])(
    "does not authenticate a supplied identity when DEV_AUTH_ENABLED=%s",
    async (flag) => {
      vi.stubEnv("DEV_AUTH_ENABLED", flag);
      const response = await request(protectedApp([UserRole.CITIZEN]))
        .get("/protected")
        .set(DEVELOPMENT_USER_HEADER, ids.citizen);

      expect(response.status).toBe(503);
      expect(response.body.error.code).toBe("DEVELOPMENT_AUTH_DISABLED");
    },
  );

  it("uses the explicit flag instead of NODE_ENV", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const response = await request(protectedApp([UserRole.CITIZEN]))
      .get("/protected")
      .set(DEVELOPMENT_USER_HEADER, ids.citizen);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ userId: ids.citizen, role: UserRole.CITIZEN });
  });

  it("keeps health endpoints public without resolving a user", async () => {
    const resolver = vi.fn<ResolveDevelopmentAuthUser>(async () => {
      throw new Error("health must not authenticate");
    });

    expect(
      (await request(createApp({ resolveDevelopmentAuthUser: resolver })).get("/health")).status,
    ).toBe(200);
    expect(
      (await request(createApp({ resolveDevelopmentAuthUser: resolver })).get("/api/v1/health"))
        .status,
    ).toBe(200);
    expect(resolver).not.toHaveBeenCalled();
  });
});

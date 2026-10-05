import type { PrismaClient } from "@prisma/client";
import { UserRole, type UserRole as UserRoleValue } from "@disaster/domain";
import type { AuthContext } from "@disaster/shared-types";
import type { RequestHandler } from "express";
import { z } from "zod";
import { HttpError } from "./errors.js";

export const DEVELOPMENT_USER_HEADER = "X-Dev-User-Id";

export interface DevelopmentAuthUser {
  readonly id: string;
  readonly role: UserRoleValue;
  readonly volunteer: { readonly assignedAreaId: string } | null;
  readonly dmcOfficer: { readonly canBroadcast: boolean } | null;
  readonly districtOfficer: { readonly districtId: string } | null;
}

export type ResolveDevelopmentAuthUser = (userId: string) => Promise<DevelopmentAuthUser | null>;

export function createPrismaDevelopmentAuthResolver(
  client: PrismaClient,
): ResolveDevelopmentAuthUser {
  return (userId) =>
    client.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        role: true,
        volunteer: { select: { assignedAreaId: true } },
        dmcOfficer: { select: { canBroadcast: true } },
        districtOfficer: { select: { districtId: true } },
      },
    });
}

function missingRoleProfile(role: UserRoleValue): HttpError {
  return new HttpError(
    403,
    "ROLE_PROFILE_REQUIRED",
    `The stored ${role} user is missing its required role profile.`,
  );
}

function buildAuthContext(user: DevelopmentAuthUser): AuthContext {
  const identity = { userId: user.id, role: user.role };

  switch (user.role) {
    case UserRole.CITIZEN:
      return identity;
    case UserRole.VOLUNTEER:
      if (!user.volunteer) throw missingRoleProfile(user.role);
      return { ...identity, assignedAreaId: user.volunteer.assignedAreaId };
    case UserRole.DMC_DUTY_OFFICER:
      if (!user.dmcOfficer) throw missingRoleProfile(user.role);
      return { ...identity, canBroadcast: user.dmcOfficer.canBroadcast };
    case UserRole.DISTRICT_OFFICER:
      if (!user.districtOfficer) throw missingRoleProfile(user.role);
      return { ...identity, districtId: user.districtOfficer.districtId };
  }
}

const userIdSchema = z.string().uuid();

export function createDevelopmentAuthContext(
  resolveUser: ResolveDevelopmentAuthUser,
): RequestHandler {
  return async (request, response, next) => {
    const suppliedUserId = request.header(DEVELOPMENT_USER_HEADER)?.trim();
    if (!suppliedUserId) {
      next();
      return;
    }

    if (process.env.DEV_AUTH_ENABLED !== "true") {
      next(
        new HttpError(503, "DEVELOPMENT_AUTH_DISABLED", "Development authentication is disabled."),
      );
      return;
    }

    const parsedUserId = userIdSchema.safeParse(suppliedUserId);
    if (!parsedUserId.success) {
      next(new HttpError(401, "UNAUTHENTICATED", "A valid development user is required."));
      return;
    }

    let user: DevelopmentAuthUser | null;
    try {
      user = await resolveUser(parsedUserId.data);
    } catch {
      next(
        new HttpError(
          503,
          "AUTH_DEPENDENCY_UNAVAILABLE",
          "The authentication data source is unavailable.",
        ),
      );
      return;
    }

    if (!user) {
      next(new HttpError(401, "UNAUTHENTICATED", "A valid development user is required."));
      return;
    }

    try {
      response.locals.auth = buildAuthContext(user);
      next();
    } catch (error) {
      next(error);
    }
  };
}

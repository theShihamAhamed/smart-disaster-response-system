import type { UserRole } from "@disaster/domain";
import type { AuthContext } from "@disaster/shared-types";
import type { RequestHandler } from "express";
import { HttpError } from "./errors.js";

export const requireRoles = (...allowedRoles: readonly UserRole[]): RequestHandler => {
  return (_request, response, next) => {
    const auth = response.locals.auth;
    if (!auth) {
      next(new HttpError(401, "UNAUTHENTICATED", "Authentication is required."));
      return;
    }
    if (!allowedRoles.includes(auth.role)) {
      next(new HttpError(403, "FORBIDDEN", "The current role cannot perform this operation."));
      return;
    }
    next();
  };
};

export function requireOwnDistrict(auth: AuthContext, districtId: string): void {
  if (!auth.districtId || auth.districtId !== districtId) {
    throw new HttpError(
      403,
      "DISTRICT_SCOPE_REQUIRED",
      "Access is limited to the assigned district.",
    );
  }
}

import { reliefAllocationLookupPathParamsSchema } from "@disaster/shared-validation";
import type { RequestHandler } from "express";

import { HttpError } from "../../errors.js";
import { ReliefCommandError } from "./relief-command-errors.js";
import type { ReliefCommandActor, ReliefCommandOperations } from "./relief-command-service.js";

function actorFrom(response: Parameters<RequestHandler>[1]): ReliefCommandActor {
  const auth = response.locals.auth;
  if (!auth) throw new HttpError(401, "UNAUTHENTICATED", "Authentication is required.");
  if (!auth.districtId) {
    throw new HttpError(
      403,
      "ROLE_PROFILE_REQUIRED",
      "The District Officer profile is missing its district assignment.",
    );
  }
  return { officerId: auth.userId, districtId: auth.districtId };
}

export function reliefCommandErrorToHttp(error: ReliefCommandError): HttpError {
  switch (error.code) {
    case "ALLOCATION_NOT_FOUND":
      return new HttpError(404, error.code, error.message);
    case "IDEMPOTENCY_MISMATCH":
    case "ALLOCATION_DATA_INTEGRITY_ERROR":
      return new HttpError(409, error.code, error.message);
    case "INVALID_ALLOCATION_COMMAND":
      return new HttpError(422, error.code, error.message);
    case "ALLOCATION_DEPENDENCY_UNAVAILABLE":
    case "ALLOCATION_TRANSACTION_NOT_AVAILABLE":
      return new HttpError(503, error.code, error.message);
  }
}

export function createReliefCommandController(service: ReliefCommandOperations) {
  const getReceiptByIdempotencyKey: RequestHandler = async (request, response, next) => {
    try {
      const { key } = reliefAllocationLookupPathParamsSchema.parse(request.params);
      const receipt = await service.getReceiptByIdempotencyKey(actorFrom(response), key);
      response.status(200).json(receipt);
    } catch (error) {
      next(error instanceof ReliefCommandError ? reliefCommandErrorToHttp(error) : error);
    }
  };

  return { getReceiptByIdempotencyKey } as const;
}

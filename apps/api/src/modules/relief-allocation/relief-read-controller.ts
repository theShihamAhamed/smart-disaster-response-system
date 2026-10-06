import {
  reliefRequestPathParamsSchema,
  reliefRequestQueueQuerySchema,
} from "@disaster/shared-validation";
import type { ReliefRequestQueueQuery } from "@disaster/shared-types";
import type { RequestHandler } from "express";

import { HttpError } from "../../errors.js";
import { ReliefReadError } from "./relief-read-errors.js";
import type { ReliefReadActor, ReliefReadOperations } from "./relief-read-service.js";

function actorFrom(response: Parameters<RequestHandler>[1]): ReliefReadActor {
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

export function reliefReadErrorToHttp(error: ReliefReadError): HttpError {
  switch (error.code) {
    case "RELIEF_REQUEST_NOT_FOUND":
      return new HttpError(404, error.code, error.message);
    case "RELIEF_DATA_INTEGRITY_ERROR":
      return new HttpError(409, error.code, error.message);
    case "STOCK_LEDGER_UNAVAILABLE":
    case "RELIEF_READ_UNAVAILABLE":
      return new HttpError(503, error.code, error.message);
  }
}

export function createReliefReadController(service: ReliefReadOperations) {
  const listRankedRequests: RequestHandler = async (request, response, next) => {
    try {
      const parsedQuery = reliefRequestQueueQuerySchema.parse(request.query);
      const query: ReliefRequestQueueQuery = {
        ...(parsedQuery.status === undefined ? {} : { status: parsedQuery.status }),
        ...(parsedQuery.zoneSeverity === undefined
          ? {}
          : { zoneSeverity: parsedQuery.zoneSeverity }),
      };
      const result = await service.listRankedRequests(actorFrom(response), query);
      response.status(200).json(result);
    } catch (error) {
      next(error instanceof ReliefReadError ? reliefReadErrorToHttp(error) : error);
    }
  };

  const getRequestDetails: RequestHandler = async (request, response, next) => {
    try {
      const { requestId } = reliefRequestPathParamsSchema.parse(request.params);
      const result = await service.getRequestDetails(actorFrom(response), requestId);
      response.status(200).json(result);
    } catch (error) {
      next(error instanceof ReliefReadError ? reliefReadErrorToHttp(error) : error);
    }
  };

  return { listRankedRequests, getRequestDetails } as const;
}

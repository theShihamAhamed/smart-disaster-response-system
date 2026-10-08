import type { ApiErrorEnvelope, FieldErrors } from "@disaster/shared-types";
import type { ErrorRequestHandler } from "express";
import { ZodError } from "zod";

export class HttpError extends Error {
  public constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly fieldErrors: FieldErrors = {},
    public readonly details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export function errorEnvelope(
  code: string,
  message: string,
  fieldErrors: FieldErrors = {},
  details: Readonly<Record<string, unknown>> = {},
): ApiErrorEnvelope {
  return { error: { code, message, fieldErrors, details } };
}

function zodFieldErrors(error: ZodError): FieldErrors {
  const flattened = error.flatten().fieldErrors;
  return Object.fromEntries(
    Object.entries(flattened).map(([field, messages]) => [field, messages ?? []]),
  );
}

export const errorHandler: ErrorRequestHandler = (error: unknown, _request, response, next) => {
  void next;
  if (error instanceof ZodError) {
    response
      .status(422)
      .json(errorEnvelope("VALIDATION_ERROR", "Request validation failed.", zodFieldErrors(error)));
    return;
  }

  if (error instanceof HttpError) {
    response
      .status(error.status)
      .json(errorEnvelope(error.code, error.message, error.fieldErrors, error.details));
    return;
  }
  // Errors raised by express.json() when the body is not valid JSON or is too large.
  const bodyErrorType =
    typeof error === "object" && error !== null && "type" in error ? error.type : undefined;
  if (bodyErrorType === "entity.parse.failed") {
    response.status(400).json(errorEnvelope("INVALID_JSON", "The request body is not valid JSON."));
    return;
  }
  if (bodyErrorType === "entity.too.large") {
    response.status(413).json(errorEnvelope("PAYLOAD_TOO_LARGE", "The request body is too large."));
    return;
  }
  response.status(500).json(errorEnvelope("INTERNAL_ERROR", "An unexpected error occurred."));
};

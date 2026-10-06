import { UserRole } from "@disaster/domain";
import { alertSeveritySchema, uuidSchema } from "@disaster/shared-validation";
import type { RequestHandler } from "express";
import { z } from "zod";
import { HttpError } from "../../errors.js";
import type { HazardBroadcastService } from "./alert.service.js";
import {
  AlertAlreadyActiveError,
  AlertNotActiveError,
  AlertNotFoundError,
  AlertNotInDraftError,
  ReportNotFoundError,
  ReportNotVerifiedError,
  SimilarAlertActiveError,
  ValidationError,
} from "./types.js";

const reportIdParamsSchema = z.object({ reportId: uuidSchema });
const alertIdParamsSchema = z.object({ alertId: uuidSchema });

const updateDraftBodySchema = z
  .object({
    severity: alertSeveritySchema,
    message: z
      .string()
      .trim()
      .min(1, "Alert message cannot be blank.")
      .max(1000, "Alert message cannot exceed 1000 characters."),
    safetyInstructions: z
      .string()
      .trim()
      .min(1, "Safety instructions cannot be blank.")
      .max(1000, "Safety instructions cannot exceed 1000 characters."),
    targetZoneIds: z
      .array(uuidSchema)
      .min(1, "At least one target zone must be selected."),
  })
  .strict();

function mapFeatureError(error: unknown): Error {
  if (error instanceof ReportNotFoundError || error instanceof AlertNotFoundError) {
    return new HttpError(404, "NOT_FOUND", "The requested resource was not found.");
  }
  if (error instanceof ReportNotVerifiedError) {
    return new HttpError(
      409,
      "REPORT_NOT_VERIFIED",
      "Only verified hazard reports can create an alert draft.",
      {},
      { status: error.status },
    );
  }
  if (error instanceof AlertAlreadyActiveError) {
    return new HttpError(
      409,
      "ALERT_ALREADY_ACTIVE",
      "The alert is already ACTIVE and cannot be broadcast again.",
      {},
      { status: error.status },
    );
  }
  if (error instanceof AlertNotActiveError) {
    return new HttpError(
      409,
      "ALERT_NOT_ACTIVE",
      "A replacement draft can only be created from an ACTIVE alert.",
      {},
      { status: error.status },
    );
  }
  if (error instanceof AlertNotInDraftError) {
    return new HttpError(
      409,
      "ALERT_NOT_IN_DRAFT",
      "Only draft alerts can be edited or broadcast.",
      {},
      { status: error.status },
    );
  }
  if (error instanceof SimilarAlertActiveError) {
    return new HttpError(
      409,
      "SIMILAR_ALERT_ACTIVE",
      "A similar active alert already exists for this hazard type and target zone.",
      {},
      { similarAlertIds: error.similarAlertIds },
    );
  }
  if (error instanceof ValidationError) {
    return new HttpError(422, "VALIDATION_ERROR", "Request validation failed.", {
      reason: [error.message],
    });
  }
  return error instanceof Error ? error : new Error("Unexpected alert broadcast error.");
}

function parseReportIdParam(params: Record<string, unknown>): string {
  const parsed = reportIdParamsSchema.safeParse(params);
  if (!parsed.success) {
    throw new ReportNotFoundError(String(params.reportId ?? "unknown"));
  }
  return parsed.data.reportId;
}

function parseAlertIdParam(params: Record<string, unknown>): string {
  const parsed = alertIdParamsSchema.safeParse(params);
  if (!parsed.success) {
    throw new AlertNotFoundError(String(params.alertId ?? "unknown"));
  }
  return parsed.data.alertId;
}

export class AlertController {
  public constructor(private readonly service: HazardBroadcastService) {}

  public readonly createFromReport: RequestHandler = async (request, response, next) => {
    try {
      const reportId = parseReportIdParam(request.params);
      const officerId = response.locals.auth!.userId;
      const result = await this.service.createAlertFromVerifiedReport({
        reportId,
        officerId,
      });
      response.status(result.isNew ? 201 : 200).json(result.alert);
    } catch (error) {
      next(mapFeatureError(error));
    }
  };

  public readonly updateDraft: RequestHandler = async (request, response, next) => {
    try {
      const alertId = parseAlertIdParam(request.params);
      const body = updateDraftBodySchema.parse(request.body);
      const updated = await this.service.updateDraftAlert({
        alertId,
        severity: body.severity,
        message: body.message,
        safetyInstructions: body.safetyInstructions,
        targetZoneIds: body.targetZoneIds,
      });
      response.status(200).json(updated);
    } catch (error) {
      next(mapFeatureError(error));
    }
  };

  public readonly getPreview: RequestHandler = async (request, response, next) => {
    try {
      const alertId = parseAlertIdParam(request.params);
      const preview = await this.service.getAlertPreview(alertId);
      response.status(200).json(preview);
    } catch (error) {
      next(mapFeatureError(error));
    }
  };

  public readonly getSimilarActive: RequestHandler = async (request, response, next) => {
    try {
      const alertId = parseAlertIdParam(request.params);
      const similarAlerts = await this.service.findSimilarActiveAlerts(alertId);
      response.status(200).json(similarAlerts);
    } catch (error) {
      next(mapFeatureError(error));
    }
  };

  public readonly broadcastAlert: RequestHandler = async (request, response, next) => {
    try {
      const auth = response.locals.auth;
      if (!auth || auth.role !== UserRole.DMC_DUTY_OFFICER || !auth.canBroadcast) {
        throw new HttpError(
          403,
          "FORBIDDEN",
          "The current officer does not have permission to broadcast alerts.",
        );
      }

      const alertId = parseAlertIdParam(request.params);
      const idempotencyKey = request.header("Idempotency-Key");
      if (idempotencyKey) {
        uuidSchema.parse(idempotencyKey);
      }

      const result = await this.service.broadcastAlert({
        alertId,
        officerId: auth.userId,
      });

      response.status(200).json(result);
    } catch (error) {
      next(mapFeatureError(error));
    }
  };

  public readonly createReplacementDraft: RequestHandler = async (request, response, next) => {
    try {
      const auth = response.locals.auth;
      if (!auth || auth.role !== UserRole.DMC_DUTY_OFFICER || !auth.canBroadcast) {
        throw new HttpError(
          403,
          "FORBIDDEN",
          "The current officer does not have permission to broadcast alerts.",
        );
      }

      const parentAlertId = parseAlertIdParam(request.params);
      const replacement = await this.service.createReplacementDraft({
        parentAlertId,
        officerId: auth.userId,
      });

      response.status(201).json(replacement);
    } catch (error) {
      next(mapFeatureError(error));
    }
  };
}

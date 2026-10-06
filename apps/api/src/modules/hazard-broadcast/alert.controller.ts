import { uuidSchema } from "@disaster/shared-validation";
import type { RequestHandler } from "express";
import { z } from "zod";
import { HttpError } from "../../errors.js";
import type { HazardBroadcastService } from "./alert.service.js";
import { ReportNotFoundError, ReportNotVerifiedError, ValidationError } from "./types.js";

const reportIdParamsSchema = z.object({ reportId: uuidSchema });

function mapFeatureError(error: unknown): Error {
  if (error instanceof ReportNotFoundError) {
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
  if (error instanceof ValidationError) {
    return new HttpError(422, "VALIDATION_ERROR", "Request validation failed.", {
      reason: [error.message],
    });
  }
  return error instanceof Error ? error : new Error("Unexpected alert broadcast error.");
}

export class AlertController {
  public constructor(private readonly service: HazardBroadcastService) {}

  public readonly createFromReport: RequestHandler = async (request, response, next) => {
    try {
      const { reportId } = reportIdParamsSchema.parse(request.params);
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
}

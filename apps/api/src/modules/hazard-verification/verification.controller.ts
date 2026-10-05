import { uuidSchema, verificationResultSchema } from "@disaster/shared-validation";
import type { RequestHandler } from "express";
import { z } from "zod";
import { HttpError } from "../../errors.js";
import type { HazardVerificationService } from "./hazard-verification.service.js";
import { ReportAlreadyProcessedError, ReportNotFoundError, ValidationError } from "./types.js";

const reportIdParamsSchema = z.object({ reportId: uuidSchema });
const pendingQuerySchema = z.object({ status: z.literal("PENDING").optional() }).strict();
const decisionBodySchema = z
  .object({ result: verificationResultSchema, reason: z.string().optional() })
  .strict();

function mapFeatureError(error: unknown): Error {
  if (error instanceof ReportNotFoundError) {
    return new HttpError(404, "NOT_FOUND", "The requested resource was not found.");
  }
  if (error instanceof ValidationError) {
    return new HttpError(422, "VALIDATION_ERROR", "Request validation failed.", {
      reason: [error.message],
    });
  }
  if (error instanceof ReportAlreadyProcessedError) {
    return new HttpError(
      409,
      "REPORT_ALREADY_PROCESSED",
      "The report has already been processed.",
      {},
      { status: error.status },
    );
  }
  return error instanceof Error ? error : new Error("Unexpected verification error.");
}

export class VerificationController {
  public constructor(private readonly service: HazardVerificationService) {}

  public readonly listPendingReports: RequestHandler = async (request, response, next) => {
    try {
      pendingQuerySchema.parse(request.query);
      response.status(200).json(await this.service.listPendingReports());
    } catch (error) {
      next(mapFeatureError(error));
    }
  };

  public readonly getReportForReview: RequestHandler = async (request, response, next) => {
    try {
      const { reportId } = reportIdParamsSchema.parse(request.params);
      response.status(200).json(await this.service.getReportForReview(reportId));
    } catch (error) {
      next(mapFeatureError(error));
    }
  };

  public readonly decideReport: RequestHandler = async (request, response, next) => {
    try {
      const { reportId } = reportIdParamsSchema.parse(request.params);
      const idempotencyKey = request.header("Idempotency-Key");
      uuidSchema.parse(idempotencyKey);
      const body = decisionBodySchema.parse(request.body);
      const decision = await this.service.decideReport({
        reportId,
        officerId: response.locals.auth!.userId,
        result: body.result,
        ...(body.reason === undefined ? {} : { reason: body.reason }),
      });
      response.status(200).json(decision);
    } catch (error) {
      next(mapFeatureError(error));
    }
  };
}

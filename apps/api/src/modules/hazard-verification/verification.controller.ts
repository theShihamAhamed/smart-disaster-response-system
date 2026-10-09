import { uuidSchema, verificationResultSchema } from "@disaster/shared-validation";
import type { RequestHandler } from "express";
import { z } from "zod";
import { HttpError } from "../../errors.js";
import type { HazardBroadcastService } from "../hazard-broadcast/alert.service.js";
import {
  ReportNotFoundError as BroadcastReportNotFoundError,
  ReportNotVerifiedError,
} from "../hazard-broadcast/types.js";
import type { HazardVerificationService } from "./hazard-verification.service.js";
import { ReportAlreadyProcessedError, ReportNotFoundError, ValidationError } from "./types.js";

const reportIdParamsSchema = z.object({ reportId: uuidSchema });
const pendingQuerySchema = z.object({ status: z.literal("PENDING").optional() }).strict();
const emptyQuerySchema = z.object({}).strict();
const emptyBodySchema = z.object({}).strict();
const escalationHeadersSchema = z.object({
  idempotencyKey: z.string().trim().min(1),
});
const decisionBodySchema = z
  .object({ result: verificationResultSchema, reason: z.string().optional() })
  .strict();

function parseReportIdParam(params: Record<string, unknown>): string {
  const parsed = reportIdParamsSchema.safeParse(params);
  if (!parsed.success) {
    throw new ValidationError("reportId must be a valid UUID.");
  }
  return parsed.data.reportId;
}

function mapFeatureError(error: unknown): Error {
  if (error instanceof ReportNotFoundError) {
    return new HttpError(404, "NOT_FOUND", "The requested resource was not found.");
  }
  if (error instanceof BroadcastReportNotFoundError) {
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
  public constructor(
    private readonly service: HazardVerificationService,
    private readonly broadcastService: Pick<
      HazardBroadcastService,
      "createAlertFromVerifiedReport"
    >,
  ) {}

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
      const reportId = parseReportIdParam(request.params);
      response.status(200).json(await this.service.getReportForReview(reportId));
    } catch (error) {
      next(mapFeatureError(error));
    }
  };

  public readonly decideReport: RequestHandler = async (request, response, next) => {
    try {
      const reportId = parseReportIdParam(request.params);
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

  public readonly escalateReport: RequestHandler = async (request, response, next) => {
    try {
      const reportId = reportIdParamsSchema.parse(request.params).reportId;
      emptyQuerySchema.parse(request.query);
      emptyBodySchema.parse(request.body ?? {});
      escalationHeadersSchema.parse({
        idempotencyKey: request.header("Idempotency-Key"),
      });

      const auth = response.locals.auth;
      if (!auth) {
        throw new HttpError(401, "UNAUTHENTICATED", "Authentication is required.");
      }
      const result = await this.broadcastService.createAlertFromVerifiedReport({
        reportId,
        officerId: auth.userId,
      });

      response.status(result.isNew ? 201 : 200).json({
        alertId: result.alert.id,
        sourceReportId: result.alert.sourceReportId,
        status: result.alert.status,
        version: result.alert.version,
      });
    } catch (error) {
      next(mapFeatureError(error));
    }
  };
}

import { submitHazardReportSchema, uuidSchema } from "@disaster/shared-validation";
import type { SubmitHazardReportResponse } from "@disaster/shared-types";
import type { RequestHandler } from "express";
import { z } from "zod";
import { HttpError } from "../../errors.js";
import type { HazardSubmissionService } from "./hazard-submission.service.js";
import type { HazardReportRecord } from "./types.js";

const reportIdParamsSchema = z.object({ reportId: uuidSchema });

function toSubmitResponse(record: HazardReportRecord): SubmitHazardReportResponse {
  return {
    reportId: record.id,
    clientReportId: record.clientReportId,
    status: record.status,
    hazardType: record.hazardType,
    outsideAssignedArea: record.outsideAssignedArea,
    requiresExtraReview: record.requiresExtraReview,
    submittedAt: record.submittedAt.toISOString(),
  };
}

export class SubmissionController {
  public constructor(private readonly service: HazardSubmissionService) {}

  // POST /api/v1/hazard-reports
  public readonly submit: RequestHandler = async (request, response) => {
    const auth = response.locals.auth;
    if (!auth) {
      throw new HttpError(401, "UNAUTHENTICATED", "Authentication is required.");
    }
    const input = submitHazardReportSchema.parse(request.body);
    const { record, created } = await this.service.submit(
      auth,
      input,
      request.header("idempotency-key"),
    );
    response.status(created ? 201 : 200).json(toSubmitResponse(record));
  };

  // GET /api/v1/hazard-reports/:reportId/status
  public readonly getStatus: RequestHandler = async (request, response) => {
    const auth = response.locals.auth;
    if (!auth) {
      throw new HttpError(401, "UNAUTHENTICATED", "Authentication is required.");
    }
    const { reportId } = reportIdParamsSchema.parse(request.params);
    response.status(200).json(await this.service.getStatus(auth, reportId));
  };
}

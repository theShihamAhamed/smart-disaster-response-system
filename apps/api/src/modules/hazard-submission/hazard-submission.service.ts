import { randomUUID } from "node:crypto";
import { UserRole } from "@disaster/domain";
import type { AuthContext, HazardReportStatusResponse } from "@disaster/shared-types";
import type { SubmitHazardReportInput } from "@disaster/shared-validation";
import { HttpError } from "../../errors.js";
import type { CreateReportResult, GeoAdapter, HazardSubmissionRepository } from "./types.js";

export class HazardSubmissionService {
  public constructor(
    private readonly repository: HazardSubmissionRepository,
    private readonly geo: GeoAdapter,
    private readonly now: () => Date = () => new Date(),
    private readonly newId: () => string = randomUUID,
  ) {}

  /**
   * Idempotent submit: the same clientReportId never creates a second report.
   * The server decides status, flags and ownership - it never trusts the client for them.
   */
  public async submit(
    auth: AuthContext,
    input: SubmitHazardReportInput,
    idempotencyKey: string | undefined,
  ): Promise<CreateReportResult> {
    if (idempotencyKey?.trim() !== input.clientReportId) {
      throw new HttpError(422, "VALIDATION_ERROR", "Request validation failed.", {
        "Idempotency-Key": ["Header must be present and equal to clientReportId."],
      });
    }

    const existing = await this.guard(() =>
      this.repository.findByClientReportId(input.clientReportId),
    );
    if (existing) {
      if (existing.reporterId !== auth.userId) {
        throw new HttpError(
          409,
          "CLIENT_REPORT_ID_CONFLICT",
          "This report identifier is already in use.",
        );
      }
      return { record: existing, created: false };
    }

    const { latitude, longitude, source } = input.location;
    const outsideAssignedArea = this.isOutsideAssignedArea(auth, latitude, longitude);

    const result = await this.guard(() =>
      this.repository.create({
        id: this.newId(),
        clientReportId: input.clientReportId,
        reporterId: auth.userId,
        hazardType: input.hazardType,
        description: input.description,
        photoRef: input.photoRef,
        submittedAt: this.now(),
        outsideAssignedArea,
        requiresExtraReview: outsideAssignedArea,
        location: {
          id: this.newId(),
          latitude,
          longitude,
          districtId: this.geo.resolveDistrictId(latitude, longitude),
          source,
        },
      }),
    );
    // Lost a race with a request using the same clientReportId: only the owner may see it.
    if (!result.created && result.record.reporterId !== auth.userId) {
      throw new HttpError(
        409,
        "CLIENT_REPORT_ID_CONFLICT",
        "This report identifier is already in use.",
      );
    }
    return result;
  }

  /** Read-only: lets the reporter see PENDING / VERIFIED / REJECTED. Never changes anything. */
  public async getStatus(auth: AuthContext, reportId: string): Promise<HazardReportStatusResponse> {
    const record = await this.guard(() => this.repository.findById(reportId));
    if (!record) {
      throw new HttpError(404, "NOT_FOUND", "The requested report was not found.");
    }
    if (record.reporterId !== auth.userId) {
      throw new HttpError(403, "FORBIDDEN", "You can only view your own reports.");
    }
    return record.status === "REJECTED" && record.rejectionReason
      ? { reportId: record.id, status: record.status, reason: record.rejectionReason }
      : { reportId: record.id, status: record.status };
  }

  private isOutsideAssignedArea(auth: AuthContext, latitude: number, longitude: number): boolean {
    if (auth.role !== UserRole.VOLUNTEER) {
      return false;
    }
    // A volunteer with no assigned area cannot be checked, so the report is flagged for review.
    return auth.assignedAreaId === undefined
      ? true
      : !this.geo.isInsideArea(auth.assignedAreaId, latitude, longitude);
  }

  /** A database failure becomes a clean 503 instead of a confusing 500. */
  private async guard<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch {
      throw new HttpError(503, "DEPENDENCY_UNAVAILABLE", "The report store is unavailable.");
    }
  }
}

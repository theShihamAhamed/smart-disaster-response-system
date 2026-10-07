import type {
  HazardReportStatusResponse,
  SubmitHazardReportResponse,
} from "@disaster/shared-types";
import type { SubmitHazardReportInput } from "@disaster/shared-validation";

/** Port: the server. The real one is built on packages/api-client. */
export interface HazardReportApi {
  submit(
    payload: SubmitHazardReportInput,
    idempotencyKey: string,
  ): Promise<SubmitHazardReportResponse>;
  getStatus(reportId: string): Promise<HazardReportStatusResponse>;
}

/** No answer from the server: no signal, timeout, or a lost response. Safe to retry. */
export class HazardReportNetworkError extends Error {
  public constructor(message = "The server could not be reached.") {
    super(message);
    this.name = "HazardReportNetworkError";
  }
}

/** The server answered with an error status. */
export class HazardReportHttpError extends Error {
  public constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly fieldErrors: Readonly<Record<string, readonly string[]>> = {},
  ) {
    super(message);
    this.name = "HazardReportHttpError";
  }
}

/** Should we try this report again later without the user changing anything? */
export function isRetryable(error: unknown): boolean {
  if (error instanceof HazardReportNetworkError) {
    return true;
  }
  if (error instanceof HazardReportHttpError) {
    return error.status >= 500 || error.status === 408 || error.status === 429;
  }
  return true;
}

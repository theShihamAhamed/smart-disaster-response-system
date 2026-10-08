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

/**
 * Should a report the server answered with this status be tried again later, unchanged?
 * Server trouble (5xx), timeouts (408) and rate limits (429): yes.
 * Any other refusal (like 422 "invalid data"): no, because sending the same thing again cannot help.
 * (A missing answer, i.e. a network failure, is always retried: that never reaches this check.)
 */
export function isRetryableStatus(status: number): boolean {
  return status >= 500 || status === 408 || status === 429;
}

export function isRetryable(error: unknown): boolean {
  return (
    error instanceof HazardReportNetworkError ||
    (error instanceof HazardReportHttpError && isRetryableStatus(error.status))
  );
}

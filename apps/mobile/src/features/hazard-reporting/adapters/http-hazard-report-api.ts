import { ApiClientError, createHttpClient } from "@disaster/api-client";
import {
  HazardReportHttpError,
  HazardReportNetworkError,
  type HazardReportApi,
} from "../ports/hazard-report-api";

export interface HttpHazardReportApiOptions {
  readonly baseUrl: string;
  readonly devUserId: string | null;
  readonly timeoutMs: number;
  readonly fetchImpl?: typeof fetch;
}

const DEV_USER_HEADER = "X-Dev-User-Id";

export function fetchWithTimeout(timeoutMs: number, baseFetch: typeof fetch = fetch): typeof fetch {
  return async (input, init) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await baseFetch(input, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  };
}

function translate(error: unknown): never {
  if (error instanceof ApiClientError) {
    throw new HazardReportHttpError(
      error.status,
      error.body.error.code,
      error.message,
      error.body.error.fieldErrors,
    );
  }
  throw new HazardReportNetworkError();
}

export function createHttpHazardReportApi(options: HttpHazardReportApiOptions): HazardReportApi {
  const client = createHttpClient({
    baseUrl: options.baseUrl,
    fetchImpl: fetchWithTimeout(options.timeoutMs, options.fetchImpl),
    ...(options.devUserId ? { defaultHeaders: { [DEV_USER_HEADER]: options.devUserId } } : {}),
  });

  return {
    async submit(payload, idempotencyKey) {
      try {
        return await client.submitHazardReport(payload, idempotencyKey);
      } catch (error) {
        return translate(error);
      }
    },
    async getStatus(reportId) {
      try {
        return await client.getHazardReportStatus(reportId);
      } catch (error) {
        return translate(error);
      }
    },
  };
}

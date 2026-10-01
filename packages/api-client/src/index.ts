import type { ApiErrorEnvelope, HealthResponse } from "@disaster/shared-types";

export class ApiClientError extends Error {
  public constructor(
    public readonly status: number,
    public readonly body: ApiErrorEnvelope,
  ) {
    super(body.error.message);
    this.name = "ApiClientError";
  }
}

export interface HttpClientOptions {
  readonly baseUrl: string;
  readonly fetchImpl?: typeof fetch;
}

export function createHttpClient({ baseUrl, fetchImpl = fetch }: HttpClientOptions) {
  const normalizedBaseUrl = baseUrl.replace(/\/$/, "");

  async function getHealth(): Promise<HealthResponse> {
    const response = await fetchImpl(`${normalizedBaseUrl}/health`, {
      headers: { Accept: "application/json" },
    });
    const body = (await response.json()) as HealthResponse | ApiErrorEnvelope;
    if (!response.ok) {
      throw new ApiClientError(response.status, body as ApiErrorEnvelope);
    }
    return body as HealthResponse;
  }

  return { getHealth } as const;
}

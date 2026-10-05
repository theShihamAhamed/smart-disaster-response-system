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
  readonly defaultHeaders?: HeadersInit;
}

export type GetRequestOptions = Omit<RequestInit, "body" | "method">;

export function createHttpClient({
  baseUrl,
  fetchImpl = fetch,
  defaultHeaders,
}: HttpClientOptions) {
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, "");

  function buildHeaders(requestHeaders?: HeadersInit): Headers {
    const headers = new Headers(defaultHeaders);

    new Headers(requestHeaders).forEach((value, key) => {
      headers.set(key, value);
    });

    if (!headers.has("Accept")) {
      headers.set("Accept", "application/json");
    }

    return headers;
  }

  async function get<T>(path: string, requestOptions: GetRequestOptions = {}): Promise<T> {
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    const response = await fetchImpl(`${normalizedBaseUrl}${normalizedPath}`, {
      ...requestOptions,
      method: "GET",
      headers: buildHeaders(requestOptions.headers),
    });
    const body = (await response.json()) as T | ApiErrorEnvelope;
    if (!response.ok) {
      throw new ApiClientError(response.status, body as ApiErrorEnvelope);
    }
    return body as T;
  }

  async function getHealth(): Promise<HealthResponse> {
    return get<HealthResponse>("/health");
  }

  return { get, getHealth } as const;
}

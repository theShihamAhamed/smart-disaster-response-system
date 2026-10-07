import type {
  ApiErrorEnvelope,
  HazardReportStatusResponse,
  HealthResponse,
  SubmitHazardReportResponse,
} from "@disaster/shared-types";

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

export interface JsonRequestOptions<TBody> extends Omit<RequestInit, "body" | "method"> {
  readonly body?: TBody;
}

type SupportedMethod = "GET" | "PATCH" | "POST";

export interface SubmitHazardReportRequest {
  readonly clientReportId: string;
  readonly hazardType: string;
  readonly description: string;
  readonly photoRef: string;
  readonly location: {
    readonly latitude: number;
    readonly longitude: number;
    readonly source: string;
  };
}

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

  async function parseResponseBody(response: Response): Promise<unknown> {
    const text = await response.text();

    if (!text.trim() && response.ok) {
      return undefined;
    }

    try {
      return JSON.parse(text) as unknown;
    } catch {
      return {
        error: {
          code: "UNREADABLE_RESPONSE",
          message: "The server sent a response that could not be read.",
          fieldErrors: {},
          details: {},
        },
      } satisfies ApiErrorEnvelope;
    }
  }

  async function requestWithResponse<TResponse, TBody>(
    method: SupportedMethod,
    path: string,
    requestOptions: JsonRequestOptions<TBody>,
  ): Promise<{ readonly status: number; readonly body: TResponse }> {
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    const { body, headers: requestHeaders, ...fetchOptions } = requestOptions;
    const headers = buildHeaders(requestHeaders);
    let serializedBody: string | undefined;

    if (body !== undefined) {
      serializedBody = JSON.stringify(body);
      if (serializedBody === undefined) {
        throw new TypeError("Request body must be JSON-serializable.");
      }
      headers.set("Content-Type", "application/json");
    }

    const response = await fetchImpl(`${normalizedBaseUrl}${normalizedPath}`, {
      ...fetchOptions,
      method,
      headers,
      ...(serializedBody === undefined ? {} : { body: serializedBody }),
    });
    const responseBody = await parseResponseBody(response);
    if (!response.ok) {
      throw new ApiClientError(response.status, responseBody as ApiErrorEnvelope);
    }
    return { status: response.status, body: responseBody as TResponse };
  }

  async function request<TResponse, TBody>(
    method: SupportedMethod,
    path: string,
    requestOptions: JsonRequestOptions<TBody>,
  ): Promise<TResponse> {
    const result = await requestWithResponse<TResponse, TBody>(method, path, requestOptions);
    return result.body;
  }

  async function get<TResponse>(
    path: string,
    requestOptions: GetRequestOptions = {},
  ): Promise<TResponse> {
    return request<TResponse, never>("GET", path, requestOptions);
  }

  async function post<TResponse, TBody = unknown>(
    path: string,
    requestOptions: JsonRequestOptions<TBody> = {},
  ): Promise<TResponse> {
    return request<TResponse, TBody>("POST", path, requestOptions);
  }

  async function postWithResponse<TResponse, TBody = unknown>(
    path: string,
    requestOptions: JsonRequestOptions<TBody> = {},
  ): Promise<{ readonly status: number; readonly body: TResponse }> {
    return requestWithResponse<TResponse, TBody>("POST", path, requestOptions);
  }

  async function patch<TResponse, TBody = unknown>(
    path: string,
    requestOptions: JsonRequestOptions<TBody> = {},
  ): Promise<TResponse> {
    return request<TResponse, TBody>("PATCH", path, requestOptions);
  }

  async function getHealth(): Promise<HealthResponse> {
    return get<HealthResponse>("/health");
  }

  async function submitHazardReport(
    input: SubmitHazardReportRequest,
    idempotencyKey: string = input.clientReportId,
  ): Promise<SubmitHazardReportResponse> {
    return post<SubmitHazardReportResponse, SubmitHazardReportRequest>("/hazard-reports", {
      body: input,
      headers: { "Idempotency-Key": idempotencyKey },
    });
  }

  async function getHazardReportStatus(reportId: string): Promise<HazardReportStatusResponse> {
    return get<HazardReportStatusResponse>(
      `/hazard-reports/${encodeURIComponent(reportId)}/status`,
    );
  }

  return {
    get,
    getHealth,
    getHazardReportStatus,
    patch,
    post,
    postWithResponse,
    submitHazardReport,
  } as const;
}

import { describe, expect, it, vi } from "vitest";
import { createVerificationApi } from "./verification-api";

function createClient(escalationHttpStatus: 200 | 201 = 201) {
  const get = vi.fn(<T>(path: string): Promise<T> => Promise.resolve({ path } as unknown as T));
  const post = vi.fn(
    <TResponse, TBody>(
      path: string,
      options: { body?: TBody; headers: HeadersInit },
    ): Promise<TResponse> => Promise.resolve({ path, ...options } as unknown as TResponse),
  );
  const postWithResponse = vi.fn(
    <TResponse, TBody>(
      path: string,
      options: { body?: TBody; headers: HeadersInit },
    ): Promise<{ readonly status: number; readonly body: TResponse }> => {
      void path;
      void options;
      return Promise.resolve({
        status: escalationHttpStatus,
        body: { alertId: "alert-1", sourceReportId: "report-1", status: "DRAFT", version: 1 },
      } as unknown as { readonly status: number; readonly body: TResponse });
    },
  );

  const client = {
    get: <T>(path: string): Promise<T> => get(path) as unknown as Promise<T>,
    post: <TResponse, TBody>(
      path: string,
      options: { body?: TBody; headers: HeadersInit },
    ): Promise<TResponse> => post(path, options) as unknown as Promise<TResponse>,
    postWithResponse: <TResponse, TBody>(
      path: string,
      options: { body?: TBody; headers: HeadersInit },
    ): Promise<{ readonly status: number; readonly body: TResponse }> =>
      postWithResponse(path, options) as unknown as Promise<{
        readonly status: number;
        readonly body: TResponse;
      }>,
  };

  return { api: createVerificationApi(client), get, post, postWithResponse };
}

describe("verification API adapter", () => {
  it("requests the pending queue with its pending status query", async () => {
    const { api, get } = createClient();

    await api.listPendingReports();

    expect(get).toHaveBeenCalledWith("/verification/reports?status=PENDING");
  });

  it("requests review details using the report ID path", async () => {
    const { api, get } = createClient();
    const reportId = "40000000-0000-4000-8000-000000000001";

    await api.getReportForReview(reportId);

    expect(get).toHaveBeenCalledWith(`/verification/reports/${reportId}`);
  });

  it("posts a VERIFIED decision with its idempotency key", async () => {
    const { api, post } = createClient();
    const reportId = "40000000-0000-4000-8000-000000000001";
    const idempotencyKey = "60000000-0000-4000-8000-000000000001";

    await api.decideReport(reportId, { result: "VERIFIED" }, idempotencyKey);

    expect(post).toHaveBeenCalledWith(`/verification/reports/${reportId}/decision`, {
      body: { result: "VERIFIED" },
      headers: { "Idempotency-Key": idempotencyKey },
    });
  });

  it("posts a REJECTED decision with the supplied trimmed reason and key", async () => {
    const { api, post } = createClient();
    const reportId = "40000000-0000-4000-8000-000000000001";
    const idempotencyKey = "60000000-0000-4000-8000-000000000002";
    const reason = "Photo does not show the reported flood location.";

    await api.decideReport(reportId, { result: "REJECTED", reason }, idempotencyKey);

    expect(post).toHaveBeenCalledWith(`/verification/reports/${reportId}/decision`, {
      body: { result: "REJECTED", reason },
      headers: { "Idempotency-Key": idempotencyKey },
    });
  });

  it("prepares a DRAFT through the escalation route without a request body", async () => {
    const { api, postWithResponse } = createClient();
    const reportId = "40000000-0000-4000-8000-000000000001";
    const idempotencyKey = "60000000-0000-4000-8000-000000000001";

    await expect(api.escalateVerifiedReport(reportId, idempotencyKey)).resolves.toEqual({
      httpStatus: 201,
      draft: {
        alertId: "alert-1",
        sourceReportId: "report-1",
        status: "DRAFT",
        version: 1,
      },
    });
    expect(postWithResponse).toHaveBeenCalledWith(`/verification/reports/${reportId}/escalations`, {
      headers: { "Idempotency-Key": idempotencyKey },
    });
  });

  it("rejects a blank escalation key before making the request", async () => {
    const { api, postWithResponse } = createClient();

    await expect(
      api.escalateVerifiedReport("40000000-0000-4000-8000-000000000001", "  "),
    ).rejects.toThrow(/idempotency key is required/i);
    expect(postWithResponse).not.toHaveBeenCalled();
  });

  it("preserves HTTP 200 when an existing draft is returned", async () => {
    const { api } = createClient(200);

    await expect(
      api.escalateVerifiedReport(
        "40000000-0000-4000-8000-000000000001",
        "60000000-0000-4000-8000-000000000001",
      ),
    ).resolves.toMatchObject({ httpStatus: 200, draft: { status: "DRAFT" } });
  });

  it("propagates shared API client errors without replacing them", async () => {
    const failure = new Error("API unavailable");
    const api = createVerificationApi({
      get: async <T>(_path: string): Promise<T> => {
        void _path;
        throw failure;
      },
      post: async <TResponse, TBody>(
        _path: string,
        _options: { body?: TBody; headers: HeadersInit },
      ): Promise<TResponse> => {
        void _path;
        void _options;
        throw failure;
      },
      postWithResponse: async <TResponse, TBody>(
        _path: string,
        _options: { body?: TBody; headers: HeadersInit },
      ): Promise<{ readonly status: number; readonly body: TResponse }> => {
        void _path;
        void _options;
        throw failure;
      },
    });

    await expect(api.listPendingReports()).rejects.toBe(failure);
    await expect(
      api.decideReport(
        "40000000-0000-4000-8000-000000000001",
        { result: "VERIFIED" },
        "60000000-0000-4000-8000-000000000001",
      ),
    ).rejects.toBe(failure);
    await expect(
      api.escalateVerifiedReport(
        "40000000-0000-4000-8000-000000000001",
        "60000000-0000-4000-8000-000000000001",
      ),
    ).rejects.toBe(failure);
  });
});

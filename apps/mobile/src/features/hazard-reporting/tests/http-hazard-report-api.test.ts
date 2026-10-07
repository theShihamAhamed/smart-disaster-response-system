import { afterEach, describe, expect, it, vi } from "vitest";
import { createHttpHazardReportApi, fetchWithTimeout } from "../adapters/http-hazard-report-api";
import { HazardReportHttpError, HazardReportNetworkError } from "../ports/hazard-report-api";
import { buildSubmitPayload } from "../validation/report-validation";
import { completeDraft } from "../testing/builders";

afterEach(() => {
  vi.useRealTimers();
});

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const draft = completeDraft();
const payload = buildSubmitPayload(draft, "photo://1.jpg");
const ack = {
  reportId: "22222222-2222-4222-8222-222222222222",
  clientReportId: payload.clientReportId,
  status: "PENDING",
  hazardType: "FLOOD",
  outsideAssignedArea: false,
  requiresExtraReview: false,
  submittedAt: "2026-10-05T10:00:00.000Z",
};

function api(
  fetchImpl: typeof fetch,
  devUserId: string | null = "10000000-0000-4000-8000-000000000001",
) {
  return createHttpHazardReportApi({
    baseUrl: "http://localhost:4000/api/v1",
    devUserId,
    timeoutMs: 1_000,
    fetchImpl,
  });
}

describe("createHttpHazardReportApi", () => {
  it("POSTs the report with the Idempotency-Key and the development user header", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(json(201, ack));
    await expect(api(fetchImpl).submit(payload, payload.clientReportId)).resolves.toEqual(ack);
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe("http://localhost:4000/api/v1/hazard-reports");
    const headers = new Headers(init?.headers);
    expect(headers.get("Idempotency-Key")).toBe(payload.clientReportId);
    expect(headers.get("X-Dev-User-Id")).toBe("10000000-0000-4000-8000-000000000001");
  });

  it("leaves out the development header when no user is configured", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(json(201, ack));
    await api(fetchImpl, null).submit(payload, payload.clientReportId);
    expect(new Headers(fetchImpl.mock.calls[0]?.[1]?.headers).has("X-Dev-User-Id")).toBe(false);
  });

  it("turns a server validation error into HazardReportHttpError with the field errors", async () => {
    const body = {
      error: {
        code: "VALIDATION_ERROR",
        message: "Request validation failed.",
        fieldErrors: { description: ["Too short"] },
        details: {},
      },
    };
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(json(422, body));
    const failure = await api(fetchImpl)
      .submit(payload, payload.clientReportId)
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(HazardReportHttpError);
    expect(failure).toMatchObject({
      status: 422,
      code: "VALIDATION_ERROR",
      fieldErrors: { description: ["Too short"] },
    });
  });

  it("turns 'no connection' into HazardReportNetworkError", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new TypeError("Network request failed"));
    await expect(api(fetchImpl).submit(payload, payload.clientReportId)).rejects.toBeInstanceOf(
      HazardReportNetworkError,
    );
    await expect(api(fetchImpl).getStatus("r1")).rejects.toBeInstanceOf(HazardReportNetworkError);
  });

  it("gives up on a request that never answers", async () => {
    vi.useFakeTimers();
    const hanging: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("Aborted", "AbortError")),
        );
      });
    const pending = api(hanging)
      .submit(payload, payload.clientReportId)
      .catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await pending).toBeInstanceOf(HazardReportNetworkError);
  });

  it("reads a report's status, including a 404", async () => {
    const ok = vi
      .fn<typeof fetch>()
      .mockResolvedValue(json(200, { reportId: "r1", status: "VERIFIED" }));
    await expect(api(ok).getStatus("r1")).resolves.toEqual({ reportId: "r1", status: "VERIFIED" });
    const missing = vi.fn<typeof fetch>().mockResolvedValue(
      json(404, {
        error: { code: "NOT_FOUND", message: "Missing", fieldErrors: {}, details: {} },
      }),
    );
    await expect(api(missing).getStatus("r1")).rejects.toMatchObject({ status: 404 });
  });
});

describe("fetchWithTimeout", () => {
  it("passes an abort signal to fetch and returns the response", async () => {
    const base = vi.fn<typeof fetch>().mockResolvedValue(json(200, {}));
    const response = await fetchWithTimeout(500, base)("http://x", { method: "GET" });
    expect(response.status).toBe(200);
    expect(base.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
  });
});

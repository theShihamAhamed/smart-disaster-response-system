import { describe, expect, it, vi } from "vitest";
import { ApiClientError, createHttpClient } from "./index";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const request = {
  clientReportId: "11111111-1111-4111-8111-111111111111",
  hazardType: "FLOOD",
  description: "Flood water is crossing the main road.",
  photoRef: "photo://1.jpg",
  location: { latitude: 6.9271, longitude: 79.8612, source: "GPS" },
};

const ack = {
  reportId: "22222222-2222-4222-8222-222222222222",
  clientReportId: request.clientReportId,
  status: "PENDING",
  hazardType: "FLOOD",
  outsideAssignedArea: false,
  requiresExtraReview: false,
  submittedAt: "2026-10-05T10:00:00.000Z",
};

function clientWith(fetchImpl: typeof fetch) {
  return createHttpClient({
    baseUrl: "http://localhost:4000/api/v1/",
    fetchImpl,
    defaultHeaders: { "X-Dev-User-Id": "10000000-0000-4000-8000-000000000001" },
  });
}

describe("submitHazardReport", () => {
  it("POSTs the JSON body with the Idempotency-Key equal to clientReportId", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(json(201, ack));
    await expect(clientWith(fetchImpl).submitHazardReport(request)).resolves.toEqual(ack);

    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe("http://localhost:4000/api/v1/hazard-reports");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual(request);
    const headers = new Headers(init?.headers);
    expect(headers.get("Idempotency-Key")).toBe(request.clientReportId);
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(headers.get("X-Dev-User-Id")).toBe("10000000-0000-4000-8000-000000000001");
  });

  it("accepts a 200 idempotent repeat the same way as a 201", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(json(200, ack));
    await expect(clientWith(fetchImpl).submitHazardReport(request)).resolves.toEqual(ack);
  });

  it("throws the API error envelope for a validation failure", async () => {
    const body = {
      error: {
        code: "VALIDATION_ERROR",
        message: "Request validation failed.",
        fieldErrors: { description: ["Too short"] },
        details: {},
      },
    };
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(json(422, body));
    const failure = await clientWith(fetchImpl)
      .submitHazardReport(request)
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ApiClientError);
    expect((failure as ApiClientError).status).toBe(422);
    expect((failure as ApiClientError).body.error.fieldErrors).toEqual({
      description: ["Too short"],
    });
  });

  it("turns a non-JSON error page into a readable error instead of crashing", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("<html>Bad gateway</html>", { status: 502 }));
    const failure = await clientWith(fetchImpl)
      .submitHazardReport(request)
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ApiClientError);
    expect((failure as ApiClientError).status).toBe(502);
    expect((failure as ApiClientError).body.error.code).toBe("UNREADABLE_RESPONSE");
  });

  it("treats an empty success body as unreadable", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response("", { status: 201 }));
    await expect(clientWith(fetchImpl).submitHazardReport(request)).rejects.toBeInstanceOf(
      ApiClientError,
    );
  });

  it("lets a network failure pass through untouched", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new TypeError("Network request failed"));
    await expect(clientWith(fetchImpl).submitHazardReport(request)).rejects.toBeInstanceOf(
      TypeError,
    );
  });
});

describe("getHazardReportStatus", () => {
  it("GETs the status of one report", async () => {
    const body = { reportId: ack.reportId, status: "REJECTED", reason: "Not a flood." };
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(json(200, body));
    await expect(clientWith(fetchImpl).getHazardReportStatus(ack.reportId)).resolves.toEqual(body);
    expect(fetchImpl.mock.calls[0]?.[0]).toBe(
      `http://localhost:4000/api/v1/hazard-reports/${ack.reportId}/status`,
    );
  });
});

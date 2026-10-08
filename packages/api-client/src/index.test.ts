import { describe, expect, it, vi } from "vitest";
import { ApiClientError, createHttpClient } from "./index";

describe("api client", () => {
  it("normalizes the base URL and returns the typed health response", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ status: "ok" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const client = createHttpClient({ baseUrl: "http://localhost:4000///", fetchImpl });
    await expect(client.getHealth()).resolves.toEqual({ status: "ok" });
    expect(fetchImpl).toHaveBeenCalledWith("http://localhost:4000/health", expect.any(Object));
  });

  it("merges default authentication with per-request headers", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ items: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const client = createHttpClient({
      baseUrl: "http://localhost:4000/api/v1",
      fetchImpl,
      defaultHeaders: { "X-Dev-User-Id": "11111111-1111-4111-8111-111111111111" },
    });

    await client.get<{ items: never[] }>("relief-requests", {
      headers: { "X-Request-Id": "request-1" },
    });

    const request = fetchImpl.mock.calls[0];
    const headers = new Headers(request?.[1]?.headers);
    expect(headers.get("X-Dev-User-Id")).toBe("11111111-1111-4111-8111-111111111111");
    expect(headers.get("X-Request-Id")).toBe("request-1");
    expect(headers.get("Accept")).toBe("application/json");
  });

  it("posts typed JSON with custom headers and preserves all defaults", async () => {
    interface CreateRequest {
      readonly quantity: number;
    }

    interface CreateResponse {
      readonly id: string;
    }

    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ id: "created-1" }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const client = createHttpClient({
      baseUrl: "http://localhost:4000/api/v1",
      fetchImpl,
      defaultHeaders: {
        Accept: "application/json",
        "X-Client-Version": "test",
        "X-Dev-User-Id": "11111111-1111-4111-8111-111111111111",
      },
    });

    await expect(
      client.post<CreateResponse, CreateRequest>("resources", {
        body: { quantity: 2 },
        headers: { "Idempotency-Key": "22222222-2222-4222-8222-222222222222" },
      }),
    ).resolves.toEqual({ id: "created-1" });

    const [url, request] = fetchImpl.mock.calls[0] ?? [];
    const headers = new Headers(request?.headers);
    expect(url).toBe("http://localhost:4000/api/v1/resources");
    expect(request?.method).toBe("POST");
    expect(request?.body).toBe(JSON.stringify({ quantity: 2 }));
    expect(headers.get("Accept")).toBe("application/json");
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(headers.get("Idempotency-Key")).toBe("22222222-2222-4222-8222-222222222222");
    expect(headers.get("X-Client-Version")).toBe("test");
    expect(headers.get("X-Dev-User-Id")).toBe("11111111-1111-4111-8111-111111111111");
    expect(headers.has("role")).toBe(false);
    expect(headers.has("districtId")).toBe(false);
    expect(headers.has("canBroadcast")).toBe(false);
    expect(headers.has("officerId")).toBe(false);
    expect(headers.has("assignedAreaId")).toBe(false);
  });

  it("exposes response status for callers that need to distinguish successful outcomes", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ alertId: "alert-1" }), { status: 201 }));
    const client = createHttpClient({ baseUrl: "http://localhost:4000/api/v1", fetchImpl });

    await expect(
      client.postWithResponse<{ alertId: string }>("/verification/escalations", {
        headers: { "Idempotency-Key": "attempt-1" },
      }),
    ).resolves.toEqual({ status: 201, body: { alertId: "alert-1" } });
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://localhost:4000/api/v1/verification/escalations",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("patches typed JSON and parses a 200 response", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ status: "updated" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const client = createHttpClient({ baseUrl: "http://localhost:4000/api/v1", fetchImpl });

    await expect(
      client.patch<{ status: string }, { version: number }>("/resources/resource-1", {
        body: { version: 3 },
      }),
    ).resolves.toEqual({ status: "updated" });

    const request = fetchImpl.mock.calls[0];
    const headers = new Headers(request?.[1]?.headers);
    expect(request?.[1]?.method).toBe("PATCH");
    expect(request?.[1]?.body).toBe(JSON.stringify({ version: 3 }));
    expect(headers.get("Content-Type")).toBe("application/json");
  });

  it("returns undefined for a successful response with no body", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));
    const client = createHttpClient({ baseUrl: "http://localhost:4000/api/v1", fetchImpl });

    await expect(client.post<void>("/resources/recalculate")).resolves.toBeUndefined();
  });

  it("propagates an API error envelope from a mutation", async () => {
    const body = {
      error: {
        code: "CONFLICT",
        message: "The resource changed.",
        fieldErrors: {},
        details: { currentVersion: 4 },
      },
    };
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify(body), { status: 409 }));
    const client = createHttpClient({ baseUrl: "http://localhost:4000/api/v1", fetchImpl });

    await expect(client.post("/resources", { body: { version: 3 } })).rejects.toMatchObject({
      status: 409,
      body,
      message: "The resource changed.",
    });
  });

  it("rejects malformed JSON responses consistently", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("not-json", { status: 200 }));
    const client = createHttpClient({ baseUrl: "http://localhost:4000/api/v1", fetchImpl });

    await expect(client.patch("/resources/resource-1", { body: { version: 3 } })).rejects.toThrow(
      SyntaxError,
    );
  });

  it("throws the frozen API error on failure", async () => {
    const body = { error: { code: "DOWN", message: "Unavailable", fieldErrors: {}, details: {} } };
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify(body), { status: 503 }));
    const client = createHttpClient({ baseUrl: "http://localhost:4000", fetchImpl });
    await expect(client.getHealth()).rejects.toBeInstanceOf(ApiClientError);
  });
});

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

  it("throws the frozen API error on failure", async () => {
    const body = { error: { code: "DOWN", message: "Unavailable", fieldErrors: {}, details: {} } };
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify(body), { status: 503 }));
    const client = createHttpClient({ baseUrl: "http://localhost:4000", fetchImpl });
    await expect(client.getHealth()).rejects.toBeInstanceOf(ApiClientError);
  });
});

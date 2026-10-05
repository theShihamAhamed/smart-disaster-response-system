import { afterEach, describe, expect, it, vi } from "vitest";

import { createWebApiClient } from "./web-api-client";

describe("web API client", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("uses the configured base URL and development identity header", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ items: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const client = createWebApiClient(
      {
        apiBaseUrl: "https://api.example.test/api/v1",
        devUserId: "11111111-1111-4111-8111-111111111111",
      },
      fetchImpl,
    );

    await client.get<{ items: never[] }>("/relief-requests", {
      headers: { "X-Request-Id": "request-1" },
    });

    const [url, request] = fetchImpl.mock.calls[0] ?? [];
    const headers = new Headers(request?.headers);
    expect(url).toBe("https://api.example.test/api/v1/relief-requests");
    expect(headers.get("X-Dev-User-Id")).toBe("11111111-1111-4111-8111-111111111111");
    expect(headers.get("X-Request-Id")).toBe("request-1");
    expect(headers.has("X-User-Role")).toBe(false);
    expect(headers.has("X-District-Id")).toBe(false);
    expect(headers.has("X-Can-Broadcast")).toBe(false);
  });

  it("does not send a development identity header when none is configured", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ items: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const client = createWebApiClient({ apiBaseUrl: "https://api.example.test/api/v1" }, fetchImpl);

    await client.get<{ items: never[] }>("/relief-requests");

    const request = fetchImpl.mock.calls[0];
    const headers = new Headers(request?.[1]?.headers);
    expect(headers.has("X-Dev-User-Id")).toBe(false);
  });

  it("creates the shared instance from the centralized Vite configuration", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ status: "ok" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubEnv("VITE_API_BASE_URL", "https://api.example.test/api/v1/");
    vi.stubEnv("VITE_DEV_USER_ID", "11111111-1111-4111-8111-111111111111");
    vi.stubGlobal("fetch", fetchImpl);

    const { sharedApiClient } = await import("./shared-api-client");
    await sharedApiClient.getHealth();

    const [url, request] = fetchImpl.mock.calls[0] ?? [];
    const headers = new Headers(request?.headers);
    expect(url).toBe("https://api.example.test/api/v1/health");
    expect(headers.get("X-Dev-User-Id")).toBe("11111111-1111-4111-8111-111111111111");
  });
});

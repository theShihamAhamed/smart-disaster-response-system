import { describe, expect, it, vi } from "vitest";
import { ApiClientError, createHttpClient } from "./index";

describe("health client", () => {
  it("returns the typed health response", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ status: "ok" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const client = createHttpClient({ baseUrl: "http://localhost:4000/", fetchImpl });
    await expect(client.getHealth()).resolves.toEqual({ status: "ok" });
    expect(fetchImpl).toHaveBeenCalledWith("http://localhost:4000/health", expect.any(Object));
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

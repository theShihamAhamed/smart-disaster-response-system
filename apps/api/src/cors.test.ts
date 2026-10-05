import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createApp } from "./app.js";
import { readWebOrigin, WEB_CORS_HEADERS, WEB_CORS_METHODS } from "./cors.js";

const ALLOWED_ORIGIN = "http://localhost:5173";

function createTestApp() {
  return createApp({ resolveDevelopmentAuthUser: vi.fn() });
}

describe("web CORS policy", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("allows the configured origin while keeping the health endpoint functional", async () => {
    vi.stubEnv("WEB_ORIGIN", `${ALLOWED_ORIGIN}/`);

    const response = await request(createTestApp())
      .get("/api/v1/health")
      .set("Origin", ALLOWED_ORIGIN);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok" });
    expect(response.headers["access-control-allow-origin"]).toBe(ALLOWED_ORIGIN);
  });

  it("allows the shared methods and headers in a preflight response", async () => {
    vi.stubEnv("WEB_ORIGIN", ALLOWED_ORIGIN);

    const response = await request(createTestApp())
      .options("/api/v1/health")
      .set("Origin", ALLOWED_ORIGIN)
      .set("Access-Control-Request-Method", "PATCH")
      .set("Access-Control-Request-Headers", "Content-Type, X-Dev-User-Id");

    const methods = String(response.headers["access-control-allow-methods"]).split(",");
    const headers = String(response.headers["access-control-allow-headers"])
      .split(",")
      .map((header) => header.trim().toLowerCase());

    expect(response.status).toBe(204);
    expect(response.headers["access-control-allow-origin"]).toBe(ALLOWED_ORIGIN);
    expect(methods).toEqual(expect.arrayContaining([...WEB_CORS_METHODS]));
    expect(headers).toEqual(
      expect.arrayContaining(WEB_CORS_HEADERS.map((header) => header.toLowerCase())),
    );
  });

  it("does not grant permission to an unapproved origin", async () => {
    vi.stubEnv("WEB_ORIGIN", ALLOWED_ORIGIN);

    const response = await request(createTestApp())
      .get("/api/v1/health")
      .set("Origin", "https://unapproved.example");

    expect(response.status).toBe(200);
    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("defaults safely to no browser origin when WEB_ORIGIN is missing", async () => {
    vi.stubEnv("WEB_ORIGIN", "");

    const response = await request(createTestApp())
      .get("/api/v1/health")
      .set("Origin", ALLOWED_ORIGIN);

    expect(response.status).toBe(200);
    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it.each([
    "localhost:5173",
    "ftp://localhost:5173",
    "https://example.test/web",
    "https://user:password@example.test",
  ])("rejects invalid WEB_ORIGIN value %s", (webOrigin) => {
    expect(() => readWebOrigin({ WEB_ORIGIN: webOrigin })).toThrow(/WEB_ORIGIN/);
  });
});

import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";

describe("body-parser errors", () => {
  it("returns 400 INVALID_JSON for malformed JSON", async () => {
    const response = await request(createApp())
      .post("/api/v1/anything")
      .set("Content-Type", "application/json")
      .send('{"broken');
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("INVALID_JSON");
  });

  it("returns 413 PAYLOAD_TOO_LARGE for bodies over 1 MB", async () => {
    const response = await request(createApp())
      .post("/api/v1/anything")
      .set("Content-Type", "application/json")
      .send(JSON.stringify({ big: "x".repeat(1_200_000) }));
    expect(response.status).toBe(413);
    expect(response.body.error.code).toBe("PAYLOAD_TOO_LARGE");
  });
});

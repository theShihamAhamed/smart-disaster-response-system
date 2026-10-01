import { UserRole } from "@disaster/domain";
import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { requireOwnDistrict, requireRoles } from "./authorization.js";
import { createApp } from "./app.js";
import { errorHandler } from "./errors.js";
import { validateBody } from "./validation.js";
import { z } from "zod";

describe("API foundation", () => {
  it("serves health at root and versioned paths with request IDs", async () => {
    const root = await request(createApp()).get("/health").set("x-request-id", "test-request");
    expect(root.status).toBe(200);
    expect(root.body).toEqual({ status: "ok" });
    expect(root.headers["x-request-id"]).toBe("test-request");

    const versioned = await request(createApp()).get("/api/v1/health");
    expect(versioned.status).toBe(200);
    expect(versioned.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("returns the central 404 error envelope", async () => {
    const response = await request(createApp()).get("/missing");
    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      error: {
        code: "NOT_FOUND",
        message: "The requested resource was not found.",
        fieldErrors: {},
        details: {},
      },
    });
  });

  it("maps Zod validation errors to 422", async () => {
    const app = express();
    app.use(express.json());
    app.post(
      "/validate",
      validateBody(z.object({ id: z.string().uuid() })),
      (_request, response) => {
        response.sendStatus(204);
      },
    );
    app.use(errorHandler);
    const response = await request(app).post("/validate").send({ id: "bad" });
    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
    expect(response.body.error.fieldErrors.id).toBeTruthy();
  });

  it("enforces trusted role context and district scope", async () => {
    const app = express();
    app.get("/unauthenticated", requireRoles(UserRole.DMC_DUTY_OFFICER), (_request, response) =>
      response.sendStatus(204),
    );
    app.get(
      "/district",
      (_request, response, next) => {
        response.locals.auth = { userId: "u1", role: UserRole.DISTRICT_OFFICER, districtId: "d1" };
        next();
      },
      requireRoles(UserRole.DISTRICT_OFFICER),
      (_request, response) => {
        requireOwnDistrict(response.locals.auth, "d1");
        response.sendStatus(204);
      },
    );
    app.use(errorHandler);

    expect((await request(app).get("/unauthenticated")).status).toBe(401);
    expect((await request(app).get("/district")).status).toBe(204);
    expect(() =>
      requireOwnDistrict({ userId: "u1", role: UserRole.DISTRICT_OFFICER, districtId: "d1" }, "d2"),
    ).toThrow("Access is limited");
  });
});

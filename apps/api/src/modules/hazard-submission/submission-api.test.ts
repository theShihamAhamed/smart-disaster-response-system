import { UserRole } from "@disaster/domain";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../app.js";
import type { DevelopmentAuthUser } from "../../development-auth.js";
import { HazardSubmissionService } from "./hazard-submission.service.js";
import { InMemoryHazardSubmissionRepository } from "./in-memory-hazard-submission.repository.js";
import { createSeedGeoAdapter, SEED_VOLUNTEER_AREA_ID } from "./mock-geo-adapter.js";

const ids = {
  citizen: "10000000-0000-4000-8000-000000000001",
  volunteer: "10000000-0000-4000-8000-000000000002",
  officer: "10000000-0000-4000-8000-000000000003",
};
const users = new Map<string, DevelopmentAuthUser>([
  [
    ids.citizen,
    {
      id: ids.citizen,
      role: UserRole.CITIZEN,
      volunteer: null,
      dmcOfficer: null,
      districtOfficer: null,
    },
  ],
  [
    ids.volunteer,
    {
      id: ids.volunteer,
      role: UserRole.VOLUNTEER,
      volunteer: { assignedAreaId: SEED_VOLUNTEER_AREA_ID },
      dmcOfficer: null,
      districtOfficer: null,
    },
  ],
  [
    ids.officer,
    {
      id: ids.officer,
      role: UserRole.DMC_DUTY_OFFICER,
      volunteer: null,
      dmcOfficer: { canBroadcast: false },
      districtOfficer: null,
    },
  ],
]);

const CLIENT_ID = "11111111-1111-4111-8111-111111111111";
const body = {
  clientReportId: CLIENT_ID,
  hazardType: "FLOOD",
  description: "Flood water is crossing the main road.",
  photoRef: "photo://1.jpg",
  location: { latitude: 6.9271, longitude: 79.8612, source: "GPS" },
};

describe("hazard report endpoints", () => {
  let repository: InMemoryHazardSubmissionRepository;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    vi.stubEnv("DEV_AUTH_ENABLED", "true");
    repository = new InMemoryHazardSubmissionRepository();
    app = createApp({
      resolveDevelopmentAuthUser: (id) => Promise.resolve(users.get(id) ?? null),
      submissionService: new HazardSubmissionService(repository, createSeedGeoAdapter()),
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const post = (
    userId: string | undefined,
    payload: unknown,
    key: string | undefined = CLIENT_ID,
  ) => {
    let req = request(app).post("/api/v1/hazard-reports");
    if (userId) req = req.set("X-Dev-User-Id", userId);
    if (key) req = req.set("Idempotency-Key", key);
    return req.send(payload as object);
  };

  it("POST creates a PENDING report (201) and a repeat returns it again (200)", async () => {
    const first = await post(ids.citizen, body);
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({
      clientReportId: CLIENT_ID,
      status: "PENDING",
      outsideAssignedArea: false,
    });

    const repeat = await post(ids.citizen, body);
    expect(repeat.status).toBe(200);
    expect(repeat.body.reportId).toBe(first.body.reportId);
    expect(repository.records).toHaveLength(1);
  });

  it("POST ignores a client-supplied status or reporter", async () => {
    const response = await post(ids.citizen, {
      ...body,
      status: "VERIFIED",
      reporterId: ids.officer,
    });
    expect(response.status).toBe(201);
    expect(response.body.status).toBe("PENDING");
    expect(repository.records[0]?.reporterId).toBe(ids.citizen);
  });

  it("POST flags an outside-area volunteer report but still accepts it", async () => {
    const response = await post(ids.volunteer, {
      ...body,
      location: { latitude: 7.29, longitude: 80.63, source: "MANUAL" },
    });
    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ outsideAssignedArea: true, requiresExtraReview: true });
  });

  it("POST returns 401 without a user and 401 for an unknown or malformed user", async () => {
    expect((await post(undefined, body)).status).toBe(401);
    expect((await post("10000000-0000-4000-8000-0000000000ff", body)).status).toBe(401);
    expect((await post("not-a-uuid", body)).status).toBe(401);
  });

  it("POST returns 403 for an officer role", async () => {
    expect((await post(ids.officer, body)).status).toBe(403);
  });

  it("POST returns 422 with field errors for invalid data", async () => {
    const response = await post(ids.citizen, { ...body, description: "short", photoRef: "" });
    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
    expect(Object.keys(response.body.error.fieldErrors)).toEqual(
      expect.arrayContaining(["description", "photoRef"]),
    );
    expect(repository.records).toHaveLength(0);
  });

  it("POST returns 422 when the Idempotency-Key header is missing or different", async () => {
    expect((await post(ids.citizen, body, "")).status).toBe(422);
    expect((await post(ids.citizen, body, "22222222-2222-4222-8222-222222222222")).status).toBe(
      422,
    );
  });

  it("POST returns 400 for malformed JSON", async () => {
    const response = await request(app)
      .post("/api/v1/hazard-reports")
      .set("X-Dev-User-Id", ids.citizen)
      .set("Content-Type", "application/json")
      .send('{"broken');
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("INVALID_JSON");
  });

  it("GET status works for the owner and is blocked for others", async () => {
    const created = await post(ids.citizen, body);
    const url = `/api/v1/hazard-reports/${created.body.reportId}/status`;

    const own = await request(app).get(url).set("X-Dev-User-Id", ids.citizen);
    expect(own.status).toBe(200);
    expect(own.body).toEqual({ reportId: created.body.reportId, status: "PENDING" });

    expect((await request(app).get(url).set("X-Dev-User-Id", ids.volunteer)).status).toBe(403);
    expect((await request(app).get(url)).status).toBe(401);
  });

  it("GET status returns 404 for an unknown report and 422 for a malformed id", async () => {
    const missing = "99999999-9999-4999-8999-999999999999";
    expect(
      (
        await request(app)
          .get(`/api/v1/hazard-reports/${missing}/status`)
          .set("X-Dev-User-Id", ids.citizen)
      ).status,
    ).toBe(404);
    expect(
      (
        await request(app)
          .get("/api/v1/hazard-reports/abc/status")
          .set("X-Dev-User-Id", ids.citizen)
      ).status,
    ).toBe(422);
  });

  it("keeps /api/v1/health public", async () => {
    expect((await request(app).get("/api/v1/health")).status).toBe(200);
  });
});

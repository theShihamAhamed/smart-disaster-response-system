import { UserRole } from "@disaster/domain";
import type { AuthContext } from "@disaster/shared-types";
import type { SubmitHazardReportInput } from "@disaster/shared-validation";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "../../errors.js";
import { HazardSubmissionService } from "./hazard-submission.service.js";
import { InMemoryHazardSubmissionRepository } from "./in-memory-hazard-submission.repository.js";
import { createSeedGeoAdapter, SEED_VOLUNTEER_AREA_ID } from "./mock-geo-adapter.js";
import type { HazardSubmissionRepository } from "./types.js";

const citizen: AuthContext = {
  userId: "c0000000-0000-4000-8000-000000000001",
  role: UserRole.CITIZEN,
};
const volunteer: AuthContext = {
  userId: "c0000000-0000-4000-8000-000000000002",
  role: UserRole.VOLUNTEER,
  assignedAreaId: SEED_VOLUNTEER_AREA_ID,
};
const otherCitizen: AuthContext = {
  userId: "c0000000-0000-4000-8000-000000000003",
  role: UserRole.CITIZEN,
};

const CLIENT_ID = "11111111-1111-4111-8111-111111111111";
const inside = { latitude: 6.9271, longitude: 79.8612, source: "GPS" } as const;
const outside = { latitude: 7.29, longitude: 80.63, source: "MANUAL" } as const;

function input(overrides: Partial<SubmitHazardReportInput> = {}): SubmitHazardReportInput {
  return {
    clientReportId: CLIENT_ID,
    hazardType: "FLOOD",
    description: "Flood water is crossing the main road.",
    photoRef: "photo://1.jpg",
    location: inside,
    ...overrides,
  };
}

describe("HazardSubmissionService.submit", () => {
  let repository: InMemoryHazardSubmissionRepository;
  let service: HazardSubmissionService;
  let counter: number;

  beforeEach(() => {
    repository = new InMemoryHazardSubmissionRepository();
    counter = 0;
    service = new HazardSubmissionService(
      repository,
      createSeedGeoAdapter(),
      () => new Date("2026-10-05T10:00:00.000Z"),
      () => `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`,
    );
  });

  it("creates a PENDING report for a citizen and never flags it", async () => {
    const { record, created } = await service.submit(citizen, input(), CLIENT_ID);
    expect(created).toBe(true);
    expect(record).toMatchObject({
      status: "PENDING",
      reporterId: citizen.userId,
      outsideAssignedArea: false,
      requiresExtraReview: false,
      submittedAt: new Date("2026-10-05T10:00:00.000Z"),
    });
    expect(repository.records).toHaveLength(1);
  });

  it("accepts a volunteer report inside the assigned area without a flag", async () => {
    const { record } = await service.submit(volunteer, input(), CLIENT_ID);
    expect(record).toMatchObject({
      status: "PENDING",
      outsideAssignedArea: false,
      requiresExtraReview: false,
    });
  });

  it("accepts an outside-area volunteer report and flags it for extra review", async () => {
    const { record, created } = await service.submit(
      volunteer,
      input({ location: outside }),
      CLIENT_ID,
    );
    expect(created).toBe(true);
    expect(record).toMatchObject({
      status: "PENDING",
      outsideAssignedArea: true,
      requiresExtraReview: true,
    });
  });

  it("treats a point exactly on the area boundary as inside", async () => {
    const edge = { latitude: 7.05, longitude: 79.95, source: "GPS" } as const;
    const { record } = await service.submit(volunteer, input({ location: edge }), CLIENT_ID);
    expect(record.outsideAssignedArea).toBe(false);
  });

  it("flags a volunteer who has no assigned area", async () => {
    const noArea: AuthContext = { userId: volunteer.userId, role: UserRole.VOLUNTEER };
    const { record } = await service.submit(noArea, input(), CLIENT_ID);
    expect(record.requiresExtraReview).toBe(true);
  });

  it("returns the same report for a repeated clientReportId (idempotent)", async () => {
    const first = await service.submit(citizen, input(), CLIENT_ID);
    const second = await service.submit(citizen, input(), CLIENT_ID);
    expect(second.created).toBe(false);
    expect(second.record.id).toBe(first.record.id);
    expect(repository.records).toHaveLength(1);
  });

  it("refuses to reveal or reuse another reporter's clientReportId", async () => {
    await service.submit(citizen, input(), CLIENT_ID);
    await expect(service.submit(otherCitizen, input(), CLIENT_ID)).rejects.toMatchObject({
      status: 409,
      code: "CLIENT_REPORT_ID_CONFLICT",
    });
  });

  it("rejects a missing or mismatched Idempotency-Key with 422", async () => {
    for (const key of [undefined, "", "22222222-2222-4222-8222-222222222222"]) {
      await expect(service.submit(citizen, input(), key)).rejects.toMatchObject({ status: 422 });
    }
    expect(repository.records).toHaveLength(0);
  });

  it("handles a race: the other request already created it for the same user", async () => {
    const racing = new InMemoryHazardSubmissionRepository();
    const first = await new HazardSubmissionService(racing, createSeedGeoAdapter()).submit(
      citizen,
      input(),
      CLIENT_ID,
    );
    // Simulate "not found yet" on the first lookup, then the unique index makes create() return it.
    vi.spyOn(racing, "findByClientReportId").mockResolvedValueOnce(null);
    const second = await new HazardSubmissionService(racing, createSeedGeoAdapter()).submit(
      citizen,
      input(),
      CLIENT_ID,
    );
    expect(second.created).toBe(false);
    expect(second.record.id).toBe(first.record.id);
    expect(racing.records).toHaveLength(1);
  });

  it("handles a race: the winning request belonged to a different user", async () => {
    const racing = new InMemoryHazardSubmissionRepository();
    await new HazardSubmissionService(racing, createSeedGeoAdapter()).submit(
      citizen,
      input(),
      CLIENT_ID,
    );
    vi.spyOn(racing, "findByClientReportId").mockResolvedValueOnce(null);
    await expect(
      new HazardSubmissionService(racing, createSeedGeoAdapter()).submit(
        otherCitizen,
        input(),
        CLIENT_ID,
      ),
    ).rejects.toMatchObject({ status: 409, code: "CLIENT_REPORT_ID_CONFLICT" });
  });

  it("turns a database failure into 503 and never into a 500", async () => {
    const broken: HazardSubmissionRepository = {
      findById: () => Promise.reject(new Error("db down")),
      findByClientReportId: () => Promise.reject(new Error("db down")),
      create: () => Promise.reject(new Error("db down")),
    };
    const failing = new HazardSubmissionService(broken, createSeedGeoAdapter());
    await expect(failing.submit(citizen, input(), CLIENT_ID)).rejects.toMatchObject({
      status: 503,
      code: "DEPENDENCY_UNAVAILABLE",
    });
    await expect(
      failing.getStatus(citizen, "99999999-9999-4999-8999-999999999999"),
    ).rejects.toMatchObject({ status: 503 });

    const lookupOk: HazardSubmissionRepository = {
      ...broken,
      findByClientReportId: () => Promise.resolve(null),
    };
    await expect(
      new HazardSubmissionService(lookupOk, createSeedGeoAdapter()).submit(
        citizen,
        input(),
        CLIENT_ID,
      ),
    ).rejects.toMatchObject({ status: 503 });
  });
});

describe("HazardSubmissionService.getStatus", () => {
  it("returns status to the owner, includes the reason only when rejected, and blocks others", async () => {
    const repository = new InMemoryHazardSubmissionRepository();
    const service = new HazardSubmissionService(repository, createSeedGeoAdapter());
    const { record } = await service.submit(citizen, input(), CLIENT_ID);

    await expect(service.getStatus(citizen, record.id)).resolves.toEqual({
      reportId: record.id,
      status: "PENDING",
    });

    repository.records[0] = {
      ...record,
      status: "REJECTED",
      rejectionReason: "Photo shows drainage water.",
    };
    await expect(service.getStatus(citizen, record.id)).resolves.toEqual({
      reportId: record.id,
      status: "REJECTED",
      reason: "Photo shows drainage water.",
    });

    await expect(service.getStatus(otherCitizen, record.id)).rejects.toMatchObject({ status: 403 });
    await expect(
      service.getStatus(citizen, "99999999-9999-4999-8999-999999999999"),
    ).rejects.toBeInstanceOf(HttpError);
  });
});

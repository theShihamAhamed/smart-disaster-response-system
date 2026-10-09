import { describe, expect, it, vi } from "vitest";
import { UserRole } from "@disaster/domain";
import {
  DEFAULT_MAP_REGION,
  coordinatesToPoint,
  createDraft,
  describeGpsFailure,
  formReducer,
  initialFormState,
  placePin,
  pointToCoordinates,
  PhotoPersistenceError,
  PhotoRepository,
  reportBadge,
  setDescription,
  setGpsLocation,
  setHazardType,
  setPhoto,
  validateDraft,
} from ".";
import { OfflineReportRepository } from "./repositories/offline-report-repository";
import type { OfflineReportStore } from "./ports/offline-report-store";
import {
  HazardReportHttpError,
  HazardReportNetworkError,
  isRetryable,
  type HazardReportApi,
} from "./ports/hazard-report-api";
import { describeResult, serverStatusLabel } from "./presentation/labels";
import { captureGpsLocation } from "./services/gps-service";
import { ReportStatusService } from "./services/report-status-service";
import { ReportSubmissionService } from "./services/report-submission-service";
import { ReportSyncService } from "./services/report-sync-service";
import { createHttpHazardReportApi, fetchWithTimeout } from "./adapters/http-hazard-report-api";

const id = "11111111-1111-4111-8111-111111111111";
const validDraft = () =>
  setGpsLocation(
    setPhoto(
      setDescription(
        setHazardType(
          createDraft(() => id),
          "FLOOD",
        ),
        "0123456789",
      ),
      "photo://one.jpg",
    ),
    { latitude: 6.9271, longitude: 79.8612 },
  );

const acknowledgement = {
  reportId: "22222222-2222-4222-8222-222222222222",
  status: "PENDING" as const,
  outsideAssignedArea: false,
  requiresExtraReview: false,
  submittedAt: "2026-01-01T00:00:00.000Z",
  rejectionReason: null,
};

function createDependencies(
  overrides: Partial<{
    api: HazardReportApi;
    online: boolean;
    photos: PhotoRepository;
  }> = {},
) {
  let records: never[] = [];
  const store: OfflineReportStore = {
    read: vi.fn(async () => records),
    write: vi.fn(async (next) => {
      records = next as never[];
    }),
  };
  const repository = new OfflineReportRepository(store);
  const photos =
    overrides.photos ??
    new PhotoRepository({
      persist: vi.fn().mockResolvedValue({ photoRef: "uploaded://one", localUri: "local://one" }),
      remove: vi.fn().mockResolvedValue(undefined),
    });
  const api =
    overrides.api ??
    ({
      submit: vi.fn().mockResolvedValue({
        ...acknowledgement,
        clientReportId: id,
        hazardType: "FLOOD",
      }),
      getStatus: vi
        .fn()
        .mockResolvedValue({ reportId: acknowledgement.reportId, status: "VERIFIED" }),
    } satisfies HazardReportApi);
  const connectivity = {
    isOnline: vi.fn(async () => overrides.online ?? true),
    subscribe: vi.fn(() => () => undefined),
  };
  const sync = new ReportSyncService({ api, repository, photos, connectivity });
  return { api, connectivity, photos, repository, sync };
}

describe("hazard reporting foundation", () => {
  it("creates a stable draft and validates a complete GPS report", () => {
    const draft = validDraft();
    expect(draft.clientReportId).toBe(id);
    expect(validateDraft(draft)).toEqual({ ok: true, photoUri: "photo://one.jpg" });
    expect(setDescription(draft, "changed").description).toBe("changed");
  });

  it("reports field errors and supports confirmed manual pins", () => {
    const draft = createDraft(() => id);
    const invalid = validateDraft(draft);
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) {
      expect(invalid.errors).toMatchObject({
        hazardType: expect.any(String),
        description: expect.any(String),
        photo: expect.any(String),
        location: expect.any(String),
      });
    }

    const state = initialFormState(draft);
    const reviewed = formReducer(state, { type: "REVIEW_REQUESTED" });
    expect(reviewed.showReview).toBe(false);
    const pinned = formReducer(state, {
      type: "PIN_PLACED",
      pin: { latitude: 6.9, longitude: 79.9 },
    });
    expect(formReducer(pinned, { type: "PIN_CONFIRMED" }).draft.location?.source).toBe("MANUAL");
  });

  it("distinguishes an unconfirmed pin from an invalid location", () => {
    const draftWithPin = placePin(
      createDraft(() => id),
      { latitude: 6.9, longitude: 79.9 },
    );
    const unconfirmed = validateDraft(draftWithPin);
    expect(unconfirmed).toMatchObject({
      ok: false,
      errors: { location: "Confirm the pin you placed so we know it is the right spot." },
    });

    const invalidLocation = setGpsLocation(
      createDraft(() => id),
      {
        latitude: Number.NaN,
        longitude: 79.9,
      },
    );
    expect(validateDraft(invalidLocation)).toMatchObject({
      ok: false,
      errors: { location: "That location is not valid. Please choose it again." },
    });
  });

  it("handles form actions and prevents duplicate submission", () => {
    let state = initialFormState(validDraft());
    state = formReducer(state, { type: "LOCATION_REQUESTED" });
    expect(state.locationStatus).toBe("LOADING");
    state = formReducer(state, {
      type: "GPS_FAILED",
      reason: "TIMEOUT",
    });
    expect(describeGpsFailure("TIMEOUT").title).toBe("Location Not Found");
    state = formReducer(state, { type: "SUBMIT_STARTED" });
    expect(formReducer(state, { type: "SUBMIT_STARTED" })).toBe(state);
  });

  it("round-trips map coordinates and describes report states", () => {
    const point = coordinatesToPoint(
      { latitude: 6.9, longitude: 79.9 },
      { width: 100, height: 100 },
    );
    const coordinates = pointToCoordinates(point, { width: 100, height: 100 });
    expect(coordinates.latitude).toBeCloseTo(6.9);
    expect(coordinates.longitude).toBeCloseTo(79.9);
    expect(pointToCoordinates({ x: -10, y: 200 }, { width: 100, height: 100 })).toEqual({
      latitude: DEFAULT_MAP_REGION.minLatitude,
      longitude: DEFAULT_MAP_REGION.minLongitude,
    });
    expect(UserRole.CITIZEN).toBe("CITIZEN");
    expect(
      reportBadge({
        clientReportId: id,
        state: "PENDING_SYNC",
        payload: {} as never,
        localPhotoUri: null,
        createdAt: "2026-01-01",
        attempts: 0,
        lastError: null,
        needsAttention: false,
        acknowledgement: null,
      }).label,
    ).toBe("Pending Sync");
    expect(serverStatusLabel("PENDING")).toBe("Pending Verification");
    expect(serverStatusLabel("VERIFIED")).toBe("Verified");
    expect(serverStatusLabel("REJECTED")).toBe("Rejected");
    expect(describeResult({ kind: "SUBMITTED", acknowledgement }).title).toBe(
      "Pending Verification",
    );
    expect(
      describeResult({ kind: "SERVER_REJECTED", message: "Fix it", fieldErrors: {} }).tone,
    ).toBe("bad");
    expect(describeResult({ kind: "NOT_SAVED", reason: "STORAGE", message: "Storage" }).title).toBe(
      "Report not saved",
    );
    expect(describeResult({ kind: "INVALID", errors: {} }).title).toBe("Please check the form");
    expect(
      reportBadge({
        clientReportId: id,
        state: "SYNCED",
        payload: {} as never,
        localPhotoUri: null,
        createdAt: "2026-01-01",
        attempts: 1,
        lastError: null,
        needsAttention: false,
        acknowledgement,
      }).label,
    ).toBe("Pending Verification");
    expect(
      reportBadge({
        clientReportId: id,
        state: "SYNCED",
        payload: {} as never,
        localPhotoUri: null,
        createdAt: "2026-01-01",
        attempts: 1,
        lastError: null,
        needsAttention: false,
        acknowledgement: { ...acknowledgement, status: "VERIFIED" },
      }).tone,
    ).toBe("good");
    expect(
      reportBadge({
        clientReportId: id,
        state: "SYNCED",
        payload: {} as never,
        localPhotoUri: null,
        createdAt: "2026-01-01",
        attempts: 1,
        lastError: null,
        needsAttention: false,
        acknowledgement: {
          ...acknowledgement,
          status: "REJECTED",
          rejectionReason: "Duplicate",
        },
      }).hint,
    ).toBe("Duplicate");
    expect(
      describeResult({ kind: "QUEUED", clientReportId: id, reason: "SERVER_UNREACHABLE" }).body,
    ).toContain("server");
  });

  it("captures GPS success, permission failure, invalid data, and thrown errors", async () => {
    await expect(
      captureGpsLocation({
        getCurrentPosition: () => Promise.resolve({ status: "OK", latitude: 6.9, longitude: 79.9 }),
      }),
    ).resolves.toEqual({ kind: "OK", position: { latitude: 6.9, longitude: 79.9 } });
    await expect(
      captureGpsLocation({
        getCurrentPosition: () => Promise.resolve({ status: "PERMISSION_DENIED" }),
      }),
    ).resolves.toEqual({ kind: "FAILED", reason: "PERMISSION_DENIED" });
    await expect(
      captureGpsLocation({
        getCurrentPosition: () => Promise.resolve({ status: "OK", latitude: 99, longitude: 79.9 }),
      }),
    ).resolves.toEqual({ kind: "FAILED", reason: "INVALID_POSITION" });
    await expect(
      captureGpsLocation({
        getCurrentPosition: () => Promise.reject(new Error("unavailable")),
      }),
    ).resolves.toEqual({ kind: "FAILED", reason: "UNAVAILABLE" });
    expect(describeGpsFailure("PERMISSION_DENIED").body).toContain("permission");
    expect(describeGpsFailure("UNAVAILABLE").body).toContain("could not");
    expect(describeGpsFailure("INVALID_POSITION").body).toContain("does not");
  });

  it("wraps photo failures and stores offline reports safely", async () => {
    const photo = new PhotoRepository({
      persist: vi.fn().mockResolvedValue({ photoRef: "uploaded://one", localUri: "local://one" }),
      remove: vi.fn().mockRejectedValue(new Error("cleanup")),
    });
    await expect(photo.persist("source://one", id)).resolves.toEqual({
      photoRef: "uploaded://one",
      localUri: "local://one",
    });
    await expect(photo.discard("local://one")).resolves.toBeUndefined();
    const failing = new PhotoRepository({
      persist: vi.fn().mockRejectedValue(new Error("disk full")),
      remove: vi.fn(),
    });
    await expect(failing.persist("source://one", id)).rejects.toBeInstanceOf(PhotoPersistenceError);

    let records: never[] = [];
    const store: OfflineReportStore = {
      read: vi.fn(async () => records),
      write: vi.fn(async (next) => {
        records = next as never[];
      }),
    };
    const repository = new OfflineReportRepository(store);
    const payload = {
      clientReportId: id,
      hazardType: "FLOOD",
      description: "0123456789",
      photoRef: "uploaded://one",
      location: { latitude: 6.9, longitude: 79.9, source: "GPS" },
    } as never;
    await repository.savePending({
      payload,
      localPhotoUri: "local://one",
      createdAt: "2026-01-01",
    });
    expect(await repository.list()).toHaveLength(1);
    expect((await repository.recordFailure(id, "offline", false))?.attempts).toBe(1);
  });

  it("submits valid reports online, queues offline reports, and shares duplicate taps", async () => {
    const online = createDependencies();
    const service = new ReportSubmissionService({ ...online, now: () => new Date("2026-01-01") });
    const first = service.submit(validDraft());
    expect(await service.submit(validDraft())).toEqual(await first);
    expect((await first).kind).toBe("SUBMITTED");

    const offline = createDependencies({ online: false });
    const queued = await new ReportSubmissionService(offline).submit(validDraft());
    expect(queued).toMatchObject({ kind: "QUEUED", reason: "OFFLINE", clientReportId: id });

    const invalid = await new ReportSubmissionService(createDependencies()).submit(
      createDraft(() => id),
    );
    expect(invalid.kind).toBe("INVALID");

    const photoFailure = createDependencies({
      photos: new PhotoRepository({
        persist: vi.fn().mockRejectedValue(new Error("disk full")),
        remove: vi.fn(),
      }),
    });
    expect((await new ReportSubmissionService(photoFailure).submit(validDraft())).kind).toBe(
      "NOT_SAVED",
    );
    const storageFailure = createDependencies();
    storageFailure.repository.savePending = vi.fn().mockRejectedValue(new Error("full"));
    expect((await new ReportSubmissionService(storageFailure).submit(validDraft())).kind).toBe(
      "NOT_SAVED",
    );
  });

  it("handles sync success, retryable failures, refusals, missing reports, and queue draining", async () => {
    const deps = createDependencies();
    await deps.repository.savePending({
      payload: {
        clientReportId: id,
        hazardType: "FLOOD",
        description: "0123456789",
        photoRef: "uploaded://one",
        location: { latitude: 6.9, longitude: 79.9, source: "GPS" },
      },
      localPhotoUri: "local://one",
      createdAt: "2026-01-01",
    });
    expect((await deps.sync.sendOne(id)).kind).toBe("SYNCED");
    expect((await deps.repository.get(id))?.state).toBe("SYNCED");
    expect((await deps.repository.get(id))?.localPhotoUri).toBeNull();
    expect(await deps.sync.sendOne("missing")).toMatchObject({ kind: "REJECTED" });

    const retry = createDependencies({
      api: {
        submit: vi.fn().mockRejectedValue(new HazardReportNetworkError()),
        getStatus: vi.fn(),
      },
    });
    await retry.repository.savePending({
      payload: {
        clientReportId: id,
        hazardType: "FLOOD",
        description: "0123456789",
        photoRef: "uploaded://one",
        location: { latitude: 6.9, longitude: 79.9, source: "GPS" },
      },
      localPhotoUri: null,
      createdAt: "2026-01-01",
    });
    expect(await retry.sync.sendOne(id)).toMatchObject({ kind: "RETRY_LATER" });
    expect((await retry.sync.syncQueue()).remaining).toBe(1);

    const refused = createDependencies({
      api: {
        submit: vi.fn().mockRejectedValue(
          new HazardReportHttpError(422, "INVALID", "Fix it", {
            description: ["Too short"],
          }),
        ),
        getStatus: vi.fn(),
      },
    });
    await refused.repository.savePending({
      payload: {
        clientReportId: id,
        hazardType: "FLOOD",
        description: "0123456789",
        photoRef: "uploaded://one",
        location: { latitude: 6.9, longitude: 79.9, source: "GPS" },
      },
      localPhotoUri: null,
      createdAt: "2026-01-01",
    });
    expect(await refused.sync.sendOne(id)).toMatchObject({ kind: "REJECTED" });
    expect((await refused.repository.get(id))?.needsAttention).toBe(true);
    expect(isRetryable(new HazardReportHttpError(500, "X", "server"))).toBe(true);
    expect(isRetryable(new HazardReportHttpError(400, "X", "bad"))).toBe(false);
  });

  it("refreshes only synchronized statuses and keeps the old value on network errors", async () => {
    const deps = createDependencies();
    await deps.repository.savePending({
      payload: {
        clientReportId: id,
        hazardType: "FLOOD",
        description: "0123456789",
        photoRef: "uploaded://one",
        location: { latitude: 6.9, longitude: 79.9, source: "GPS" },
      },
      localPhotoUri: null,
      createdAt: "2026-01-01",
    });
    await deps.repository.markSynchronized(id, acknowledgement);
    const service = new ReportStatusService(deps.api, deps.repository);
    expect((await service.refresh(id))?.acknowledgement?.status).toBe("VERIFIED");
    expect(serverStatusLabel("REJECTED")).toBe("Rejected");
    expect(describeResult({ kind: "QUEUED", clientReportId: id, reason: "OFFLINE" }).title).toBe(
      "Pending Sync",
    );

    const failing = createDependencies({
      api: {
        submit: vi.fn(),
        getStatus: vi.fn().mockRejectedValue(new Error("offline")),
      },
    });
    await failing.repository.savePending({
      payload: {
        clientReportId: id,
        hazardType: "FLOOD",
        description: "0123456789",
        photoRef: "uploaded://one",
        location: { latitude: 6.9, longitude: 79.9, source: "GPS" },
      },
      localPhotoUri: null,
      createdAt: "2026-01-01",
    });
    await failing.repository.markSynchronized(id, acknowledgement);
    expect(
      (await new ReportStatusService(failing.api, failing.repository).refresh(id))?.acknowledgement,
    ).toEqual(acknowledgement);
    expect(
      await new ReportStatusService(failing.api, failing.repository).refreshAll(),
    ).toHaveLength(1);
  });

  it("translates HTTP and network errors and applies request timeouts", async () => {
    const payload = {
      clientReportId: id,
      hazardType: "FLOOD",
      description: "0123456789",
      photoRef: "photo://one",
      location: { latitude: 6.9, longitude: 79.9, source: "GPS" },
    } as const;
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          reportId: acknowledgement.reportId,
          clientReportId: id,
          status: "PENDING",
          hazardType: "FLOOD",
          outsideAssignedArea: false,
          requiresExtraReview: false,
          submittedAt: acknowledgement.submittedAt,
        }),
        { status: 201, headers: { "Content-Type": "application/json" } },
      ),
    );
    const api = createHttpHazardReportApi({
      baseUrl: "http://localhost/api",
      devUserId: "user-1",
      timeoutMs: 100,
      fetchImpl,
    });
    await expect(api.submit(payload, id)).resolves.toMatchObject({
      reportId: acknowledgement.reportId,
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://localhost/api/hazard-reports",
      expect.objectContaining({ method: "POST" }),
    );

    const httpApi = createHttpHazardReportApi({
      baseUrl: "http://localhost/api",
      devUserId: null,
      timeoutMs: 100,
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: { code: "BAD", message: "No", fieldErrors: {} },
          }),
          { status: 422 },
        ),
      ),
    });
    await expect(httpApi.submit(payload, id)).rejects.toMatchObject({ status: 422 });
    const networkApi = createHttpHazardReportApi({
      baseUrl: "http://localhost/api",
      devUserId: null,
      timeoutMs: 100,
      fetchImpl: vi.fn<typeof fetch>().mockRejectedValue(new Error("offline")),
    });
    await expect(networkApi.getStatus(acknowledgement.reportId)).rejects.toBeInstanceOf(
      HazardReportNetworkError,
    );
    const timeoutFetch = fetchWithTimeout(
      1,
      vi.fn<typeof fetch>().mockImplementation(
        (_input, init) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () =>
              reject(new DOMException("timeout", "AbortError")),
            );
          }),
      ),
    );
    await expect(timeoutFetch("http://localhost")).rejects.toThrow("timeout");
  });
});

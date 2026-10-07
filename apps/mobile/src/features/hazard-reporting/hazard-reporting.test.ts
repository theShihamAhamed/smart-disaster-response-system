import { describe, expect, it, vi } from "vitest";
import { UserRole } from "@disaster/domain";
import {
  DEFAULT_MAP_REGION,
  coordinatesToPoint,
  createDraft,
  describeGpsFailure,
  formReducer,
  initialFormState,
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
import { captureGpsLocation } from "./services/gps-service";

const id = "11111111-1111-4111-8111-111111111111";
const validDraft = () =>
  setGpsLocation(
    setPhoto(
      setDescription(setHazardType(createDraft(() => id), "FLOOD"), "0123456789"),
      "photo://one.jpg",
    ),
    { latitude: 6.9271, longitude: 79.8612 },
  );

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
    const point = coordinatesToPoint({ latitude: 6.9, longitude: 79.9 }, { width: 100, height: 100 });
    const coordinates = pointToCoordinates(point, { width: 100, height: 100 });
    expect(coordinates.latitude).toBeCloseTo(6.9);
    expect(coordinates.longitude).toBeCloseTo(79.9);
    expect(pointToCoordinates({ x: -10, y: 200 }, { width: 100, height: 100 })).toEqual({
      latitude: DEFAULT_MAP_REGION.minLatitude,
      longitude: DEFAULT_MAP_REGION.minLongitude,
    });
    expect(UserRole.CITIZEN).toBe("CITIZEN");
    expect(reportBadge({
      clientReportId: id,
      state: "PENDING_SYNC",
      payload: {} as never,
      localPhotoUri: null,
      createdAt: "2026-01-01",
      attempts: 0,
      lastError: null,
      needsAttention: false,
      acknowledgement: null,
    }).label).toBe("Pending Sync");
  });

  it("captures GPS success, permission failure, invalid data, and thrown errors", async () => {
    await expect(captureGpsLocation({
      getCurrentPosition: () =>
        Promise.resolve({ status: "OK", latitude: 6.9, longitude: 79.9 }),
    })).resolves.toEqual({ kind: "OK", position: { latitude: 6.9, longitude: 79.9 } });
    await expect(captureGpsLocation({
      getCurrentPosition: () => Promise.resolve({ status: "PERMISSION_DENIED" }),
    })).resolves.toEqual({ kind: "FAILED", reason: "PERMISSION_DENIED" });
    await expect(captureGpsLocation({
      getCurrentPosition: () =>
        Promise.resolve({ status: "OK", latitude: 99, longitude: 79.9 }),
    })).resolves.toEqual({ kind: "FAILED", reason: "INVALID_POSITION" });
    await expect(captureGpsLocation({
      getCurrentPosition: () => Promise.reject(new Error("unavailable")),
    })).resolves.toEqual({ kind: "FAILED", reason: "UNAVAILABLE" });
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
    await repository.savePending({ payload, localPhotoUri: "local://one", createdAt: "2026-01-01" });
    expect((await repository.list())).toHaveLength(1);
    expect((await repository.recordFailure(id, "offline", false))?.attempts).toBe(1);
  });
});

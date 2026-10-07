import {
  confirmPin,
  createDraft,
  placePin,
  setDescription,
  setGpsLocation,
  setHazardType,
  setPhoto,
} from "../form/report-draft";
import { OfflineReportRepository } from "../repositories/offline-report-repository";
import { PhotoRepository } from "../repositories/photo-repository";
import { ReportStatusService } from "../services/report-status-service";
import { ReportSubmissionService } from "../services/report-submission-service";
import { ReportSyncService } from "../services/report-sync-service";
import type { ReportDraft } from "../types";
import {
  FakeConnectivity,
  FakePhotoStorage,
  FakeServer,
  InMemoryOfflineStore,
  sequentialIds,
} from "./fakes";

export const GOOD_DESCRIPTION = "Flood water is crossing the main road.";

/** A finished, valid draft with a GPS location. Pass a different `newId` to make a different report. */
export function completeDraft(newId: () => string = sequentialIds()): ReportDraft {
  let draft = createDraft(newId);
  draft = setHazardType(draft, "FLOOD");
  draft = setDescription(draft, GOOD_DESCRIPTION);
  draft = setPhoto(draft, "file:///cache/photo.jpg");
  return setGpsLocation(draft, { latitude: 6.9271, longitude: 79.8612 });
}

/** The same, but with a manual pin the user has confirmed. */
export function completeManualDraft(newId: () => string = sequentialIds()): ReportDraft {
  let draft = completeDraft(newId);
  draft = placePin(draft, { latitude: 6.95, longitude: 79.9 });
  return confirmPin(draft);
}

/** Everything the app needs, wired to fakes. The pieces are exposed so tests can poke at them. */
export interface TestStack {
  readonly server: FakeServer;
  readonly connectivity: FakeConnectivity;
  readonly photoStorage: FakePhotoStorage;
  readonly store: InMemoryOfflineStore;
  readonly repository: OfflineReportRepository;
  readonly sync: ReportSyncService;
  readonly submission: ReportSubmissionService;
  readonly status: ReportStatusService;
}

export interface StackParts {
  readonly server?: FakeServer;
  readonly connectivity?: FakeConnectivity;
  readonly photoStorage?: FakePhotoStorage;
  readonly store?: InMemoryOfflineStore;
}

export function createStack(parts: StackParts = {}): TestStack {
  const server = parts.server ?? new FakeServer();
  const connectivity = parts.connectivity ?? new FakeConnectivity(true);
  const photoStorage = parts.photoStorage ?? new FakePhotoStorage();
  const store = parts.store ?? new InMemoryOfflineStore();
  const repository = new OfflineReportRepository(store);
  const photos = new PhotoRepository(photoStorage);
  const sync = new ReportSyncService({ api: server, repository, photos, connectivity });
  const submission = new ReportSubmissionService({
    repository,
    photos,
    sync,
    connectivity,
    now: () => new Date("2026-10-05T09:00:00.000Z"),
  });
  const status = new ReportStatusService(server, repository);
  return { server, connectivity, photoStorage, store, repository, sync, submission, status };
}

/** "Close the app and open it again": new objects, but the same phone storage and server. */
export function restartApp(stack: TestStack): TestStack {
  return createStack({
    server: stack.server,
    connectivity: stack.connectivity,
    photoStorage: stack.photoStorage,
    store: stack.store,
  });
}

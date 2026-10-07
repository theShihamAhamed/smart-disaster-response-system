import { describe, expect, it } from "vitest";
import { OfflineReportRepository } from "../repositories/offline-report-repository";
import { PhotoPersistenceError, PhotoRepository } from "../repositories/photo-repository";
import { buildSubmitPayload } from "../validation/report-validation";
import { completeDraft } from "../testing/builders";
import { FakePhotoStorage, InMemoryOfflineStore, sequentialIds } from "../testing/fakes";
import type { Acknowledgement } from "../types";

const ack: Acknowledgement = {
  reportId: "99999999-9999-4999-8999-000000000001",
  status: "PENDING",
  outsideAssignedArea: false,
  requiresExtraReview: false,
  submittedAt: "2026-10-05T10:00:00.000Z",
  rejectionReason: null,
};

function pending(newId = sequentialIds(), createdAt = "2026-10-05T09:00:00.000Z") {
  const draft = completeDraft(newId);
  return {
    id: draft.clientReportId,
    report: {
      payload: buildSubmitPayload(draft, "photo://1.jpg"),
      localPhotoUri: "file:///documents/1.jpg",
      createdAt,
    },
  };
}

describe("OfflineReportRepository", () => {
  it("saves a PENDING_SYNC report that keeps its clientReportId and photo", async () => {
    const repo = new OfflineReportRepository(new InMemoryOfflineStore());
    const { id, report } = pending();
    const saved = await repo.savePending(report);
    expect(saved).toMatchObject({
      clientReportId: id,
      state: "PENDING_SYNC",
      localPhotoUri: "file:///documents/1.jpg",
      attempts: 0,
      lastError: null,
      needsAttention: false,
      acknowledgement: null,
    });
  });

  it("survives an app restart: a new repository over the same storage sees the report", async () => {
    const store = new InMemoryOfflineStore();
    const { id, report } = pending();
    await new OfflineReportRepository(store).savePending(report);
    const afterRestart = new OfflineReportRepository(store);
    expect((await afterRestart.list()).map((r) => r.clientReportId)).toEqual([id]);
    expect(await afterRestart.get(id)).toMatchObject({ state: "PENDING_SYNC" });
  });

  it("saving the same id again replaces the old copy but keeps the original creation time", async () => {
    const repo = new OfflineReportRepository(new InMemoryOfflineStore());
    const first = pending(sequentialIds(), "2026-10-05T09:00:00.000Z");
    await repo.savePending(first.report);
    await repo.recordFailure(first.id, "no signal", true);
    const again = await repo.savePending({
      ...first.report,
      createdAt: "2026-10-05T11:00:00.000Z",
      payload: { ...first.report.payload, description: "A corrected description here" },
    });
    expect(again.createdAt).toBe("2026-10-05T09:00:00.000Z");
    expect(again.payload.description).toBe("A corrected description here");
    expect(again).toMatchObject({ attempts: 0, lastError: null, needsAttention: false });
    expect(await repo.list()).toHaveLength(1);
  });

  it("never overwrites a report the server already confirmed", async () => {
    const repo = new OfflineReportRepository(new InMemoryOfflineStore());
    const { id, report } = pending();
    await repo.savePending(report);
    await repo.markSynchronized(id, ack);
    const result = await repo.savePending(report);
    expect(result.state).toBe("SYNCED");
    expect(result.acknowledgement).toEqual(ack);
  });

  it("lists reports oldest first", async () => {
    const repo = new OfflineReportRepository(new InMemoryOfflineStore());
    const ids = sequentialIds();
    const late = pending(ids, "2026-10-05T12:00:00.000Z");
    const early = pending(ids, "2026-10-05T08:00:00.000Z");
    const sameTime = pending(ids, "2026-10-05T08:00:00.000Z");
    await repo.savePending(late.report);
    await repo.savePending(early.report);
    await repo.savePending(sameTime.report);
    expect((await repo.list()).map((r) => r.clientReportId)).toEqual([
      early.id,
      sameTime.id,
      late.id,
    ]);
  });

  it("records failures and counts the attempts", async () => {
    const repo = new OfflineReportRepository(new InMemoryOfflineStore());
    const { id, report } = pending();
    await repo.savePending(report);
    await repo.recordFailure(id, "no signal", false);
    const second = await repo.recordFailure(id, "still no signal", false);
    expect(second).toMatchObject({
      attempts: 2,
      lastError: "still no signal",
      state: "PENDING_SYNC",
    });
  });

  it("does not change a synced report when a late failure arrives", async () => {
    const repo = new OfflineReportRepository(new InMemoryOfflineStore());
    const { id, report } = pending();
    await repo.savePending(report);
    await repo.markSynchronized(id, ack);
    const result = await repo.recordFailure(id, "late failure", true);
    expect(result).toMatchObject({ state: "SYNCED", lastError: null, needsAttention: false });
  });

  it("saves the acknowledgement and the SYNCED state in one single write", async () => {
    const store = new InMemoryOfflineStore();
    const repo = new OfflineReportRepository(store);
    const { id, report } = pending();
    await repo.savePending(report);
    const writesBefore = store.writes;
    await repo.markSynchronized(id, ack);
    expect(store.writes).toBe(writesBefore + 1);
    expect(store.records[0]).toMatchObject({
      state: "SYNCED",
      acknowledgement: ack,
      lastError: null,
    });
  });

  it("clears the local photo and updates the server status of a synced report", async () => {
    const repo = new OfflineReportRepository(new InMemoryOfflineStore());
    const { id, report } = pending();
    await repo.savePending(report);
    await repo.markSynchronized(id, ack);
    expect((await repo.clearLocalPhoto(id))?.localPhotoUri).toBeNull();
    const updated = await repo.updateServerStatus(id, "REJECTED", "Not a flood.");
    expect(updated?.acknowledgement).toMatchObject({
      status: "REJECTED",
      rejectionReason: "Not a flood.",
    });
  });

  it("leaves a not-yet-synced report alone when asked to update its server status", async () => {
    const repo = new OfflineReportRepository(new InMemoryOfflineStore());
    const { id, report } = pending();
    await repo.savePending(report);
    const result = await repo.updateServerStatus(id, "VERIFIED", null);
    expect(result?.acknowledgement).toBeNull();
    expect(result?.state).toBe("PENDING_SYNC");
  });

  it("returns null for reports that do not exist", async () => {
    const repo = new OfflineReportRepository(new InMemoryOfflineStore());
    expect(await repo.get("missing")).toBeNull();
    expect(await repo.recordFailure("missing", "x", false)).toBeNull();
    expect(await repo.markSynchronized("missing", ack)).toBeNull();
    expect(await repo.clearLocalPhoto("missing")).toBeNull();
    expect(await repo.updateServerStatus("missing", "VERIFIED", null)).toBeNull();
  });

  it("does not lose reports when many are saved at the same moment", async () => {
    const repo = new OfflineReportRepository(new InMemoryOfflineStore());
    const ids = sequentialIds();
    const all = Array.from({ length: 6 }, () => pending(ids));
    await Promise.all(all.map((item) => repo.savePending(item.report)));
    expect(await repo.list()).toHaveLength(6);
  });

  it("keeps working after a storage failure and does not claim the failed save worked", async () => {
    const store = new InMemoryOfflineStore();
    const repo = new OfflineReportRepository(store);
    const first = pending();
    store.failWrites = true;
    await expect(repo.savePending(first.report)).rejects.toThrow("storage full");
    expect(await repo.list()).toHaveLength(0);
    store.failWrites = false;
    await repo.savePending(first.report);
    expect(await repo.list()).toHaveLength(1);
  });
});

describe("PhotoRepository", () => {
  it("saves a permanent copy of the photo", async () => {
    const storage = new FakePhotoStorage();
    const photo = await new PhotoRepository(storage).persist("file:///cache/a.jpg", "id-1");
    expect(photo).toEqual({ localUri: "file:///documents/id-1.jpg", photoRef: "photo://id-1.jpg" });
    expect(storage.files.has(photo.localUri)).toBe(true);
  });

  it("reports any storage problem as one PhotoPersistenceError", async () => {
    const storage = new FakePhotoStorage();
    storage.failPersist = true;
    await expect(
      new PhotoRepository(storage).persist("file:///a.jpg", "id"),
    ).rejects.toBeInstanceOf(PhotoPersistenceError);
  });

  it("never throws when a leftover photo cannot be deleted", async () => {
    const storage = new FakePhotoStorage();
    storage.failRemove = true;
    await expect(new PhotoRepository(storage).discard("file:///x.jpg")).resolves.toBeUndefined();
  });
});

import { describe, expect, it } from "vitest";
import { HazardReportHttpError } from "../ports/hazard-report-api";
import { buildSubmitPayload } from "../validation/report-validation";
import { completeDraft, createStack, restartApp, type TestStack } from "../testing/builders";
import { FakePhotoStorage, sequentialIds } from "../testing/fakes";
import type { StoredReport } from "../types";

/** Puts one report into the offline queue, the way the submission service would. */
async function queue(stack: TestStack, newId = sequentialIds()): Promise<string> {
  const draft = completeDraft(newId);
  const persisted = await stack.photoStorage.persist(draft.photoUri ?? "", draft.clientReportId);
  await stack.repository.savePending({
    payload: buildSubmitPayload(draft, persisted.photoRef),
    localPhotoUri: persisted.localUri,
    createdAt: new Date().toISOString(),
  });
  return draft.clientReportId;
}

const stateOf = async (stack: TestStack, id: string) => (await stack.repository.get(id))?.state;

describe("ReportSyncService.sendOne", () => {
  it("sends the saved payload with an Idempotency-Key equal to the clientReportId", async () => {
    const stack = createStack();
    const id = await queue(stack);
    const outcome = await stack.sync.sendOne(id);
    expect(outcome.kind).toBe("SYNCED");
    expect(stack.server.submitCalls).toHaveLength(1);
    expect(stack.server.submitCalls[0]?.key).toBe(id);
    expect(stack.server.submitCalls[0]?.payload.clientReportId).toBe(id);
  });

  it("saves the acknowledgement locally and marks the report SYNCED as Pending Verification", async () => {
    const stack = createStack();
    const id = await queue(stack);
    await stack.sync.sendOne(id);
    const record = await stack.repository.get(id);
    expect(record?.state).toBe("SYNCED");
    expect(record?.acknowledgement).toMatchObject({ status: "PENDING", rejectionReason: null });
    expect(record?.acknowledgement?.reportId).toBe(stack.server.reports.get(id)?.reportId);
  });

  it("removes the local photo ONLY AFTER the acknowledgement has been saved", async () => {
    let recordAtDeleteTime: StoredReport | undefined;
    const stack = createStack();
    class SpyStorage extends FakePhotoStorage {
      public override remove(localUri: string): Promise<void> {
        recordAtDeleteTime = stack.store.records[0];
        return super.remove(localUri);
      }
    }
    const spied = createStack({ photoStorage: new SpyStorage(), store: stack.store });
    const id = await queue(spied);
    await spied.sync.sendOne(id);
    expect(recordAtDeleteTime?.state).toBe("SYNCED");
    expect(recordAtDeleteTime?.acknowledgement).not.toBeNull();
    expect(spied.photoStorage.files.size).toBe(0);
    expect((await spied.repository.get(id))?.localPhotoUri).toBeNull();
  });

  it("keeps the local record AND the photo when the network fails", async () => {
    const stack = createStack();
    const id = await queue(stack);
    stack.server.unreachable = true;
    const outcome = await stack.sync.sendOne(id);
    expect(outcome.kind).toBe("RETRY_LATER");
    const record = await stack.repository.get(id);
    expect(record).toMatchObject({ state: "PENDING_SYNC", attempts: 1, needsAttention: false });
    expect(record?.lastError).toBeTruthy();
    expect(stack.photoStorage.files.size).toBe(1);
  });

  it("survives a lost response: the server saved it, the phone retries, still ONE server report", async () => {
    const stack = createStack();
    const id = await queue(stack);
    stack.server.loseNextResponse = true;

    expect((await stack.sync.sendOne(id)).kind).toBe("RETRY_LATER");
    expect(stack.server.reports.size).toBe(1); // the server already committed
    expect(await stateOf(stack, id)).toBe("PENDING_SYNC"); // but the phone did not know

    expect((await stack.sync.sendOne(id)).kind).toBe("SYNCED");
    expect(stack.server.reports.size).toBe(1);
    expect(stack.server.submitCalls.map((c) => c.key)).toEqual([id, id]);
    expect(await stateOf(stack, id)).toBe("SYNCED");
  });

  it("treats server errors, timeouts and rate limits as retryable", async () => {
    for (const status of [500, 503, 408, 429]) {
      const stack = createStack();
      const id = await queue(stack);
      stack.server.rejectWith = new HazardReportHttpError(status, "SERVER", "busy");
      expect((await stack.sync.sendOne(id)).kind).toBe("RETRY_LATER");
      expect((await stack.repository.get(id))?.needsAttention).toBe(false);
    }
  });

  it("marks a server refusal (422) as needing attention and keeps the report", async () => {
    const stack = createStack();
    const id = await queue(stack);
    stack.server.rejectWith = new HazardReportHttpError(422, "VALIDATION_ERROR", "Bad data", {
      description: ["Too short"],
    });
    const outcome = await stack.sync.sendOne(id);
    expect(outcome).toMatchObject({
      kind: "REJECTED",
      fieldErrors: { description: ["Too short"] },
    });
    expect(await stack.repository.get(id)).toMatchObject({
      state: "PENDING_SYNC",
      needsAttention: true,
      lastError: "Bad data",
    });
  });

  it("falls back to a friendly message when the server gives no message", async () => {
    const stack = createStack();
    const id = await queue(stack);
    stack.server.rejectWith = new HazardReportHttpError(403, "FORBIDDEN", "");
    const outcome = await stack.sync.sendOne(id);
    expect(outcome.kind === "REJECTED" && outcome.message.length > 0).toBe(true);
  });

  it("shares one request when asked twice at the same time", async () => {
    const stack = createStack();
    const id = await queue(stack);
    const [a, b] = await Promise.all([stack.sync.sendOne(id), stack.sync.sendOne(id)]);
    expect(a).toEqual(b);
    expect(stack.server.submitCalls).toHaveLength(1);
  });

  it("answers without calling the server when the report is already SYNCED", async () => {
    const stack = createStack();
    const id = await queue(stack);
    await stack.sync.sendOne(id);
    const outcome = await stack.sync.sendOne(id);
    expect(outcome.kind).toBe("SYNCED");
    expect(stack.server.submitCalls).toHaveLength(1);
  });

  it("refuses to send a report that is not on the phone", async () => {
    const outcome = await createStack().sync.sendOne("not-there");
    expect(outcome).toMatchObject({ kind: "REJECTED" });
  });

  it("still succeeds when the leftover photo cannot be deleted", async () => {
    const stack = createStack();
    const id = await queue(stack);
    stack.photoStorage.failRemove = true;
    expect((await stack.sync.sendOne(id)).kind).toBe("SYNCED");
    expect((await stack.repository.get(id))?.localPhotoUri).toBeNull();
  });

  it("carries the outside-area flags from the server without any blame", async () => {
    const stack = createStack();
    stack.server.outsideArea = true;
    const id = await queue(stack);
    const outcome = await stack.sync.sendOne(id);
    expect(outcome.kind === "SYNCED" && outcome.acknowledgement).toMatchObject({
      outsideAssignedArea: true,
      requiresExtraReview: true,
    });
  });
});

describe("ReportSyncService.syncQueue", () => {
  it("does nothing while offline and leaves everything saved", async () => {
    const stack = createStack();
    await queue(stack);
    stack.connectivity.setOnline(false);
    const summary = await stack.sync.syncQueue();
    expect(summary).toEqual({ skipped: "OFFLINE", synced: [], failed: [], remaining: 1 });
    expect(stack.server.submitCalls).toHaveLength(0);
  });

  it("sends several reports one at a time, oldest first", async () => {
    const stack = createStack();
    const ids = sequentialIds();
    const first = await queue(stack, ids);
    const second = await queue(stack, ids);
    const third = await queue(stack, ids);
    const summary = await stack.sync.syncQueue();
    expect(summary).toMatchObject({ skipped: null, remaining: 0 });
    expect(summary.synced).toEqual([first, second, third]);
    expect(stack.server.submitCalls.map((c) => c.key)).toEqual([first, second, third]);
    expect(stack.server.reports.size).toBe(3);
  });

  it("when one report is refused, the others are still sent and nothing is corrupted", async () => {
    const stack = createStack();
    const ids = sequentialIds();
    const bad = await queue(stack, ids);
    const good = await queue(stack, ids);
    const original = stack.server.submit.bind(stack.server);
    stack.server.submit = (payload, key) =>
      key === bad
        ? Promise.reject(new HazardReportHttpError(422, "VALIDATION_ERROR", "Bad data"))
        : original(payload, key);

    const summary = await stack.sync.syncQueue();
    expect(summary.synced).toEqual([good]);
    expect(summary.failed).toEqual([{ clientReportId: bad, message: "Bad data" }]);
    expect(await stateOf(stack, bad)).toBe("PENDING_SYNC");
    expect(await stateOf(stack, good)).toBe("SYNCED");
  });

  it("stops when the network fails and leaves later reports untouched", async () => {
    const stack = createStack();
    const ids = sequentialIds();
    const first = await queue(stack, ids);
    const second = await queue(stack, ids);
    stack.server.unreachable = true;
    const summary = await stack.sync.syncQueue();
    expect(summary.synced).toEqual([]);
    expect(summary.failed).toHaveLength(1);
    expect(summary.remaining).toBe(2);
    expect((await stack.repository.get(first))?.attempts).toBe(1);
    expect(await stack.repository.get(second)).toMatchObject({ attempts: 0, lastError: null });
    expect(stack.server.submitCalls).toHaveLength(1);
  });

  it("does not keep retrying a report the server refused", async () => {
    const stack = createStack();
    const id = await queue(stack);
    stack.server.rejectWith = new HazardReportHttpError(422, "VALIDATION_ERROR", "Bad data");
    await stack.sync.syncQueue();
    await stack.sync.syncQueue();
    expect(stack.server.submitCalls).toHaveLength(1);
    expect((await stack.repository.get(id))?.needsAttention).toBe(true);
  });

  it("two overlapping runs share one run", async () => {
    const stack = createStack();
    await queue(stack);
    const [a, b] = await Promise.all([stack.sync.syncQueue(), stack.sync.syncQueue()]);
    expect(a).toBe(b);
    expect(stack.server.submitCalls).toHaveLength(1);
  });

  it("can run again after a finished run", async () => {
    const stack = createStack();
    await stack.sync.syncQueue();
    await queue(stack);
    expect((await stack.sync.syncQueue()).synced).toHaveLength(1);
  });

  it("sends reports queued before an app restart once the phone is online again", async () => {
    const stack = createStack();
    stack.connectivity.setOnline(false);
    const ids = sequentialIds();
    await queue(stack, ids);
    await queue(stack, ids);

    const reopened = restartApp(stack);
    reopened.connectivity.setOnline(true);
    const summary = await reopened.sync.syncQueue();
    expect(summary.synced).toHaveLength(2);
    expect(reopened.server.reports.size).toBe(2);
  });
});

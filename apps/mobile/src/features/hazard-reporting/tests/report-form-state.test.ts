import { describe, expect, it } from "vitest";
import {
  canSubmit,
  formReducer,
  initialFormState,
  isFinished,
  type FormAction,
  type FormState,
} from "../form/report-form-state";
import { createDraft } from "../form/report-draft";
import { completeDraft } from "../testing/builders";
import { sequentialIds } from "../testing/fakes";

function run(state: FormState, ...actions: FormAction[]): FormState {
  return actions.reduce(formReducer, state);
}

const fresh = () => initialFormState(createDraft(sequentialIds()));
const ready = () => initialFormState(completeDraft());

describe("report form state", () => {
  it("starts empty with nothing loading", () => {
    expect(fresh()).toMatchObject({
      locationStatus: "IDLE",
      errors: {},
      showReview: false,
      submitting: false,
      result: null,
    });
  });

  it("uses the GPS position when it arrives", () => {
    const state = run(
      fresh(),
      { type: "LOCATION_REQUESTED" },
      { type: "GPS_SUCCEEDED", position: { latitude: 6.9, longitude: 79.8 } },
    );
    expect(state.locationStatus).toBe("GPS_OK");
    expect(state.draft.location).toEqual({ latitude: 6.9, longitude: 79.8, source: "GPS" });
  });

  it("shows loading while GPS is working", () => {
    expect(run(fresh(), { type: "LOCATION_REQUESTED" }).locationStatus).toBe("LOADING");
  });

  it("remembers why GPS failed so the screen can explain it", () => {
    const state = run(fresh(), { type: "GPS_FAILED", reason: "PERMISSION_DENIED" });
    expect(state).toMatchObject({ locationStatus: "GPS_FAILED", gpsFailure: "PERMISSION_DENIED" });
  });

  it("GPS failure followed by a confirmed manual pin ends with a MANUAL location", () => {
    const state = run(
      fresh(),
      { type: "GPS_FAILED", reason: "UNAVAILABLE" },
      { type: "PIN_PLACED", pin: { latitude: 6.95, longitude: 79.9 } },
    );
    expect(state.draft.location).toBeNull();
    const confirmed = run(state, { type: "PIN_CONFIRMED" });
    expect(confirmed.draft.location).toEqual({ latitude: 6.95, longitude: 79.9, source: "MANUAL" });
  });

  it("does not let a late GPS answer overwrite the spot the user chose by hand", () => {
    const placed = run(fresh(), { type: "PIN_PLACED", pin: { latitude: 6.95, longitude: 79.9 } });
    const late = run(placed, { type: "GPS_SUCCEEDED", position: { latitude: 1, longitude: 2 } });
    expect(late.draft.location).toBeNull();
    expect(late.draft.pendingPin).toEqual({ latitude: 6.95, longitude: 79.9 });

    const confirmed = run(placed, { type: "PIN_CONFIRMED" });
    const later = run(confirmed, {
      type: "GPS_SUCCEEDED",
      position: { latitude: 1, longitude: 2 },
    });
    expect(later.draft.location?.source).toBe("MANUAL");
  });

  it("shows every problem when the user tries to review an empty form", () => {
    const state = run(fresh(), { type: "REVIEW_REQUESTED" });
    expect(state.showReview).toBe(false);
    expect(Object.keys(state.errors).sort()).toEqual([
      "description",
      "hazardType",
      "location",
      "photo",
    ]);
  });

  it("opens the review screen for a complete form and can close it again", () => {
    const open = run(ready(), { type: "REVIEW_REQUESTED" });
    expect(open).toMatchObject({ showReview: true, errors: {} });
    expect(canSubmit(open)).toBe(true);
    expect(run(open, { type: "REVIEW_CLOSED" }).showReview).toBe(false);
  });

  it("clears a field's error as soon as the user fixes it", () => {
    let state = run(fresh(), { type: "REVIEW_REQUESTED" });
    state = run(state, { type: "HAZARD_TYPE_SELECTED", hazardType: "CYCLONE" });
    expect(state.errors.hazardType).toBeUndefined();
    state = run(state, { type: "DESCRIPTION_CHANGED", text: "Strong winds are damaging roofs" });
    expect(state.errors.description).toBeUndefined();
    state = run(state, { type: "PHOTO_SELECTED", uri: "file:///a.jpg" });
    expect(state.errors.photo).toBeUndefined();
    expect(state.errors.location).toBeDefined();
    state = run(state, { type: "PIN_PLACED", pin: { latitude: 6.9, longitude: 79.9 } });
    expect(state.errors.location).toBeUndefined();
  });

  it("lets the user replace the photo", () => {
    const state = run(
      fresh(),
      { type: "PHOTO_SELECTED", uri: "file:///one.jpg" },
      { type: "PHOTO_SELECTED", uri: "file:///two.jpg" },
    );
    expect(state.draft.photoUri).toBe("file:///two.jpg");
  });

  it("ignores a second press of Submit while the first is still working", () => {
    const open = run(ready(), { type: "REVIEW_REQUESTED" });
    const started = run(open, { type: "SUBMIT_STARTED" });
    expect(started.submitting).toBe(true);
    expect(canSubmit(started)).toBe(false);
    expect(run(started, { type: "SUBMIT_STARTED" })).toBe(started);
  });

  it("goes back to the form and marks the fields when the server-side check finds problems", () => {
    const state = run(
      run(ready(), { type: "REVIEW_REQUESTED" }),
      { type: "SUBMIT_STARTED" },
      {
        type: "SUBMIT_FINISHED",
        result: { kind: "INVALID", errors: { photo: "Add one photo of the hazard." } },
      },
    );
    expect(state).toMatchObject({ submitting: false, showReview: false });
    expect(state.errors.photo).toBe("Add one photo of the hazard.");
  });

  it("keeps the completed draft and the review open when the network fails", () => {
    const draft = completeDraft();
    const state = run(
      initialFormState(draft),
      { type: "REVIEW_REQUESTED" },
      { type: "SUBMIT_STARTED" },
      {
        type: "SUBMIT_FINISHED",
        result: { kind: "SERVER_REJECTED", message: "Please check it", fieldErrors: {} },
      },
    );
    expect(state.draft).toBe(draft);
    expect(state.showReview).toBe(true);
    expect(canSubmit(state)).toBe(true);
  });

  it("is finished once the report was received or saved, and blocks sending it again", () => {
    const submitted = run(run(ready(), { type: "REVIEW_REQUESTED" }), {
      type: "SUBMIT_FINISHED",
      result: { kind: "QUEUED", clientReportId: "x", reason: "OFFLINE" },
    });
    expect(isFinished(submitted.result)).toBe(true);
    expect(canSubmit(submitted)).toBe(false);
    expect(isFinished(null)).toBe(false);
    expect(isFinished({ kind: "NOT_SAVED", reason: "PHOTO", message: "x" })).toBe(false);
  });

  it("starts a brand-new report with a brand-new id", () => {
    const ids = sequentialIds();
    const first = initialFormState(createDraft(ids));
    const next = run(first, { type: "NEW_REPORT", draft: createDraft(ids) });
    expect(next.draft.clientReportId).not.toBe(first.draft.clientReportId);
    expect(next.result).toBeNull();
  });
});

import { describe, expect, it, vi } from "vitest";
import {
  clearLocation,
  confirmPin,
  createDraft,
  placePin,
  setDescription,
  setGpsLocation,
  setHazardType,
  setPhoto,
} from "../form/report-draft";
import { sequentialIds } from "../testing/fakes";

describe("report draft", () => {
  it("creates an empty DRAFT with an id made exactly once", () => {
    const newId = vi.fn(sequentialIds());
    const draft = createDraft(newId);
    expect(newId).toHaveBeenCalledTimes(1);
    expect(draft).toEqual({
      localState: "DRAFT",
      clientReportId: "00000000-0000-4000-8000-000000000001",
      hazardType: null,
      description: "",
      photoUri: null,
      location: null,
      pendingPin: null,
    });
  });

  it("keeps the same clientReportId through every edit", () => {
    let draft = createDraft(sequentialIds());
    const id = draft.clientReportId;
    draft = setHazardType(draft, "LANDSLIDE");
    draft = setDescription(draft, "Soil is moving above the road");
    draft = setPhoto(draft, "file:///a.jpg");
    draft = setGpsLocation(draft, { latitude: 7, longitude: 80 });
    draft = placePin(draft, { latitude: 7.1, longitude: 80.1 });
    draft = confirmPin(draft);
    draft = clearLocation(draft);
    expect(draft.clientReportId).toBe(id);
    expect(draft.hazardType).toBe("LANDSLIDE");
  });

  it("replaces the photo when the user picks another one", () => {
    let draft = createDraft(sequentialIds());
    draft = setPhoto(draft, "file:///first.jpg");
    draft = setPhoto(draft, "file:///second.jpg");
    expect(draft.photoUri).toBe("file:///second.jpg");
  });

  it("stores a GPS fix with source GPS and clears any pin", () => {
    let draft = placePin(createDraft(sequentialIds()), { latitude: 1, longitude: 2 });
    draft = setGpsLocation(draft, { latitude: 6.9, longitude: 79.8 });
    expect(draft.location).toEqual({ latitude: 6.9, longitude: 79.8, source: "GPS" });
    expect(draft.pendingPin).toBeNull();
  });

  it("does NOT accept a manual pin until it is confirmed", () => {
    const draft = placePin(createDraft(sequentialIds()), { latitude: 6.95, longitude: 79.9 });
    expect(draft.location).toBeNull();
    expect(draft.pendingPin).toEqual({ latitude: 6.95, longitude: 79.9 });
  });

  it("turns a confirmed pin into a MANUAL location", () => {
    const draft = confirmPin(
      placePin(createDraft(sequentialIds()), { latitude: 6.95, longitude: 79.9 }),
    );
    expect(draft.location).toEqual({ latitude: 6.95, longitude: 79.9, source: "MANUAL" });
    expect(draft.pendingPin).toBeNull();
  });

  it("ignores a confirmation when there is no pin", () => {
    const draft = createDraft(sequentialIds());
    expect(confirmPin(draft)).toBe(draft);
  });

  it("placing a new pin replaces an earlier location until it is confirmed", () => {
    let draft = setGpsLocation(createDraft(sequentialIds()), { latitude: 6.9, longitude: 79.8 });
    draft = placePin(draft, { latitude: 7, longitude: 80 });
    expect(draft.location).toBeNull();
    expect(clearLocation(draft).pendingPin).toBeNull();
  });
});

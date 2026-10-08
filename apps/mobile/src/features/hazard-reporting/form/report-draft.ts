import type { HazardType } from "@disaster/domain";
import type { Coordinates, ReportDraft } from "../types";

/** Starts a new report. The ID is made here, once, so every retry reuses it. */
export function createDraft(newId: () => string): ReportDraft {
  return {
    localState: "DRAFT",
    clientReportId: newId(),
    hazardType: null,
    description: "",
    photoUri: null,
    location: null,
    pendingPin: null,
  };
}

export function setHazardType(draft: ReportDraft, hazardType: HazardType): ReportDraft {
  return { ...draft, hazardType };
}

export function setDescription(draft: ReportDraft, description: string): ReportDraft {
  return { ...draft, description };
}

/** Choosing a photo again simply replaces the old one. */
export function setPhoto(draft: ReportDraft, photoUri: string): ReportDraft {
  return { ...draft, photoUri };
}

export function setGpsLocation(draft: ReportDraft, position: Coordinates): ReportDraft {
  return {
    ...draft,
    location: { latitude: position.latitude, longitude: position.longitude, source: "GPS" },
    pendingPin: null,
  };
}

/** Placing a pin does NOT set the location yet. The user must confirm it first. */
export function placePin(draft: ReportDraft, pin: Coordinates): ReportDraft {
  return {
    ...draft,
    location: null,
    pendingPin: { latitude: pin.latitude, longitude: pin.longitude },
  };
}

export function confirmPin(draft: ReportDraft): ReportDraft {
  if (draft.pendingPin === null) {
    return draft;
  }
  return {
    ...draft,
    location: {
      latitude: draft.pendingPin.latitude,
      longitude: draft.pendingPin.longitude,
      source: "MANUAL",
    },
    pendingPin: null,
  };
}

export function clearLocation(draft: ReportDraft): ReportDraft {
  return { ...draft, location: null, pendingPin: null };
}

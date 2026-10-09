import {
  hazardDescriptionSchema,
  hazardTypeSchema,
  locationSchema,
  submitHazardReportSchema,
  type SubmitHazardReportInput,
} from "@disaster/shared-validation";
import type { ReportDraft, ReportFieldErrors } from "../types";

/** On success, `photoUri` is the photo that passed the checks, so callers need not re-check it. */
export type DraftValidation =
  | { readonly ok: true; readonly photoUri: string }
  | { readonly ok: false; readonly errors: ReportFieldErrors };

export const VALIDATION_MESSAGES = {
  hazardType: "Choose what kind of hazard you saw.",
  description: "Describe what you see in 10 to 500 characters.",
  photo: "Add one photo of the hazard.",
  locationMissing: "We need the location. Allow GPS or place a pin on the map.",
  locationUnconfirmed: "Confirm the pin you placed so we know it is the right spot.",
  locationInvalid: "That location is not valid. Please choose it again.",
} as const;

/** Checks a draft and returns plain-language messages for every problem found. */
export function validateDraft(draft: ReportDraft): DraftValidation {
  let errors: ReportFieldErrors = {};

  if (!hazardTypeSchema.safeParse(draft.hazardType).success) {
    errors = { ...errors, hazardType: VALIDATION_MESSAGES.hazardType };
  }
  if (!hazardDescriptionSchema.safeParse(draft.description).success) {
    errors = { ...errors, description: VALIDATION_MESSAGES.description };
  }
  if (draft.photoUri === null || draft.photoUri.trim().length === 0) {
    errors = { ...errors, photo: VALIDATION_MESSAGES.photo };
  }
  if (draft.location === null) {
    errors = {
      ...errors,
      location:
        draft.pendingPin === null
          ? VALIDATION_MESSAGES.locationMissing
          : VALIDATION_MESSAGES.locationUnconfirmed,
    };
  } else if (!locationSchema.safeParse(draft.location).success) {
    errors = { ...errors, location: VALIDATION_MESSAGES.locationInvalid };
  }

  return Object.keys(errors).length === 0
    ? { ok: true, photoUri: draft.photoUri as string }
    : { ok: false, errors };
}

/**
 * Builds the one canonical payload that is saved and sent. The shared schema runs one last time,
 * so the phone and the server always agree (and the description is trimmed).
 */
export function buildSubmitPayload(draft: ReportDraft, photoRef: string): SubmitHazardReportInput {
  return submitHazardReportSchema.parse({
    clientReportId: draft.clientReportId,
    hazardType: draft.hazardType,
    description: draft.description,
    photoRef,
    location: draft.location,
  });
}

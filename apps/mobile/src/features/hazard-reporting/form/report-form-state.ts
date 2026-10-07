import type { HazardType } from "@disaster/domain";
import type { GpsFailureReason } from "../services/gps-service.ts";
import type { SubmissionResult } from "../services/report-submission-service.ts";
import type { Coordinates, ReportDraft, ReportFieldErrors } from "../types";
import { validateDraft } from "../validation/report-validation";
import {
  confirmPin,
  placePin,
  setDescription,
  setGpsLocation,
  setHazardType,
  setPhoto,
} from "./report-draft";

export type LocationStatus = "IDLE" | "LOADING" | "GPS_OK" | "GPS_FAILED";

/** Everything the report screen needs to know, kept in one plain object. */
export interface FormState {
  readonly draft: ReportDraft;
  readonly locationStatus: LocationStatus;
  readonly gpsFailure: GpsFailureReason | null;
  readonly errors: ReportFieldErrors;
  readonly showReview: boolean;
  readonly submitting: boolean;
  readonly result: SubmissionResult | null;
}

export type FormAction =
  | { readonly type: "LOCATION_REQUESTED" }
  | { readonly type: "GPS_SUCCEEDED"; readonly position: Coordinates }
  | { readonly type: "GPS_FAILED"; readonly reason: GpsFailureReason }
  | { readonly type: "PIN_PLACED"; readonly pin: Coordinates }
  | { readonly type: "PIN_CONFIRMED" }
  | { readonly type: "HAZARD_TYPE_SELECTED"; readonly hazardType: HazardType }
  | { readonly type: "DESCRIPTION_CHANGED"; readonly text: string }
  | { readonly type: "PHOTO_SELECTED"; readonly uri: string }
  | { readonly type: "REVIEW_REQUESTED" }
  | { readonly type: "REVIEW_CLOSED" }
  | { readonly type: "SUBMIT_STARTED" }
  | { readonly type: "SUBMIT_FINISHED"; readonly result: SubmissionResult }
  | { readonly type: "NEW_REPORT"; readonly draft: ReportDraft };

export function initialFormState(draft: ReportDraft): FormState {
  return {
    draft,
    locationStatus: "IDLE",
    gpsFailure: null,
    errors: {},
    showReview: false,
    submitting: false,
    result: null,
  };
}

function withoutError(
  errors: ReportFieldErrors,
  field: keyof ReportFieldErrors,
): ReportFieldErrors {
  const copy: { [key: string]: string | undefined } = { ...errors };
  delete copy[field];
  return copy as ReportFieldErrors;
}

export function formReducer(state: FormState, action: FormAction): FormState {
  switch (action.type) {
    case "LOCATION_REQUESTED":
      return { ...state, locationStatus: "LOADING", gpsFailure: null };

    case "GPS_SUCCEEDED": {
      // If the user already chose a spot by hand while GPS was thinking, keep their choice.
      if (state.draft.location !== null || state.draft.pendingPin !== null) {
        return { ...state, locationStatus: "GPS_OK" };
      }
      return {
        ...state,
        draft: setGpsLocation(state.draft, action.position),
        locationStatus: "GPS_OK",
        gpsFailure: null,
        errors: withoutError(state.errors, "location"),
      };
    }

    case "GPS_FAILED":
      return { ...state, locationStatus: "GPS_FAILED", gpsFailure: action.reason };

    case "PIN_PLACED":
      return {
        ...state,
        draft: placePin(state.draft, action.pin),
        errors: withoutError(state.errors, "location"),
      };

    case "PIN_CONFIRMED":
      return {
        ...state,
        draft: confirmPin(state.draft),
        errors: withoutError(state.errors, "location"),
      };

    case "HAZARD_TYPE_SELECTED":
      return {
        ...state,
        draft: setHazardType(state.draft, action.hazardType),
        errors: withoutError(state.errors, "hazardType"),
      };

    case "DESCRIPTION_CHANGED":
      return {
        ...state,
        draft: setDescription(state.draft, action.text),
        errors: withoutError(state.errors, "description"),
      };

    case "PHOTO_SELECTED":
      return {
        ...state,
        draft: setPhoto(state.draft, action.uri),
        errors: withoutError(state.errors, "photo"),
      };

    case "REVIEW_REQUESTED": {
      const validation = validateDraft(state.draft);
      return validation.ok
        ? { ...state, errors: {}, showReview: true, result: null }
        : { ...state, errors: validation.errors, showReview: false };
    }

    case "REVIEW_CLOSED":
      return { ...state, showReview: false, result: null };

    case "SUBMIT_STARTED":
      // Pressing Submit again while the first press is still working does nothing.
      return state.submitting ? state : { ...state, submitting: true, result: null };

    case "SUBMIT_FINISHED": {
      const { result } = action;
      return {
        ...state,
        submitting: false,
        result,
        errors: result.kind === "INVALID" ? result.errors : {},
        showReview: result.kind === "INVALID" ? false : state.showReview,
      };
    }

    case "NEW_REPORT":
      return initialFormState(action.draft);
  }
}

/** Can the Submit button be pressed right now? */
export function canSubmit(state: FormState): boolean {
  return state.showReview && !state.submitting && !isFinished(state.result);
}

/** A report that was received or saved is finished: the screen shows the result instead. */
export function isFinished(result: SubmissionResult | null): boolean {
  return result?.kind === "SUBMITTED" || result?.kind === "QUEUED";
}

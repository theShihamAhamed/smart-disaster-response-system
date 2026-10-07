import type { HazardType, ReportStatus } from "@disaster/domain";
import type { GpsFailureReason } from "../services/gps-service";
import type { SubmissionResult } from "../services/report-submission-service";
import type { StoredReport } from "../types";

export const HAZARD_TYPE_LABELS: Readonly<Record<HazardType, string>> = {
  FLOOD: "Flood",
  LANDSLIDE: "Landslide",
  CYCLONE: "Cyclone",
  DROUGHT: "Drought",
};

export type BadgeTone = "waiting" | "review" | "good" | "bad";

export interface StatusBadge {
  readonly label: "Pending Sync" | "Pending Verification" | "Verified" | "Rejected";
  readonly tone: BadgeTone;
  /** Extra plain-language line shown under the badge. */
  readonly hint: string | null;
}

/** The server's status words, as people should read them. */
export function serverStatusLabel(status: ReportStatus): StatusBadge["label"] {
  switch (status) {
    case "PENDING":
      return "Pending Verification";
    case "VERIFIED":
      return "Verified";
    case "REJECTED":
      return "Rejected";
  }
}

/**
 * "Pending Sync" = still only on this phone.
 * "Pending Verification" = the server has it and an officer has not decided yet.
 */
export function reportBadge(report: StoredReport): StatusBadge {
  if (report.state === "PENDING_SYNC" || report.acknowledgement === null) {
    return {
      label: "Pending Sync",
      tone: "waiting",
      hint: report.needsAttention
        ? (report.lastError ?? "The server could not accept this report.")
        : "Saved on this phone. It will be sent when you are online.",
    };
  }
  const { status, rejectionReason } = report.acknowledgement;
  return {
    label: serverStatusLabel(status),
    tone: status === "VERIFIED" ? "good" : status === "REJECTED" ? "bad" : "review",
    hint: status === "REJECTED" ? rejectionReason : null,
  };
}

export interface ResultMessage {
  readonly tone: BadgeTone;
  readonly title: string;
  readonly body: string;
}

/** Plain-language text for what happened after the user pressed Submit. */
export function describeResult(result: SubmissionResult): ResultMessage {
  switch (result.kind) {
    case "SUBMITTED":
      return {
        tone: "review",
        title: "Pending Verification",
        body: "Thank you. Your report was received. An officer will check it.",
      };
    case "QUEUED":
      return {
        tone: "waiting",
        title: "Pending Sync",
        body:
          result.reason === "OFFLINE"
            ? "You are offline. Your report is saved on this phone and will be sent automatically."
            : "We could not reach the server. Your report is saved and will be sent again soon.",
      };
    case "SERVER_REJECTED":
      return { tone: "bad", title: "Report not accepted", body: result.message };
    case "NOT_SAVED":
      return { tone: "bad", title: "Report not saved", body: result.message };
    case "INVALID":
      return {
        tone: "bad",
        title: "Please check the form",
        body: "Some details are missing or need fixing. They are marked below.",
      };
  }
}

/** The "Location Not Found" explanation shown when GPS does not work. */
export function describeGpsFailure(reason: GpsFailureReason): { title: string; body: string } {
  const why: Record<GpsFailureReason, string> = {
    PERMISSION_DENIED: "Location permission was not allowed.",
    UNAVAILABLE: "Your phone could not find your position.",
    INVALID_POSITION: "Your phone gave a position that does not look right.",
    TIMEOUT: "Finding your position took too long.",
  };
  return {
    title: "Location Not Found",
    body: `${why[reason]} You can choose the spot yourself: tap the map to place a pin, then confirm it.`,
  };
}

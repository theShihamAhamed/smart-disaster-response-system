import { describe, expect, it } from "vitest";
import {
  ALERT_SEVERITIES,
  AlertStatus,
  canTransitionReport,
  DELIVERY_STATUSES,
  ReportStatus,
  USER_ROLES,
  VerificationResult,
  isPublicAlert,
} from "./index";

describe("frozen domain contracts", () => {
  it("keeps roles, alert severity and delivery state separate", () => {
    expect(USER_ROLES).toEqual(["CITIZEN", "VOLUNTEER", "DMC_DUTY_OFFICER", "DISTRICT_OFFICER"]);
    expect(ALERT_SEVERITIES).toEqual(["ADVISORY", "WARNING", "EVACUATION"]);
    expect(DELIVERY_STATUSES).toContain("SMS_FALLBACK_QUEUED");
  });

  it("allows a final verification result only from pending", () => {
    expect(canTransitionReport(ReportStatus.PENDING, VerificationResult.VERIFIED)).toBe(true);
    expect(canTransitionReport(ReportStatus.VERIFIED, VerificationResult.REJECTED)).toBe(false);
  });

  it("exposes only active alerts as public", () => {
    expect(isPublicAlert(AlertStatus.ACTIVE)).toBe(true);
    expect(isPublicAlert(AlertStatus.DRAFT)).toBe(false);
  });
});

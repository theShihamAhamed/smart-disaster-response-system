import { describe, expect, it } from "vitest";
import {
  errorEnvelopeSchema,
  locationSchema,
  reportStatusSchema,
  userRoleSchema,
  verificationResultSchema,
} from "./index";

describe("shared validation", () => {
  it("accepts frozen role and report values", () => {
    expect(userRoleSchema.parse("DISTRICT_OFFICER")).toBe("DISTRICT_OFFICER");
    expect(reportStatusSchema.parse("PENDING")).toBe("PENDING");
    expect(verificationResultSchema.safeParse("PENDING").success).toBe(false);
  });

  it("validates coordinate boundaries", () => {
    expect(locationSchema.safeParse({ latitude: 91, longitude: 79, source: "GPS" }).success).toBe(
      false,
    );
    expect(
      locationSchema.parse({ latitude: 6.9271, longitude: 79.8612, source: "MANUAL" }),
    ).toEqual({ latitude: 6.9271, longitude: 79.8612, source: "MANUAL" });
  });

  it("validates the frozen error envelope", () => {
    expect(
      errorEnvelopeSchema.parse({
        error: { code: "VALIDATION_ERROR", message: "Invalid", fieldErrors: {}, details: {} },
      }),
    ).toBeTruthy();
  });
});

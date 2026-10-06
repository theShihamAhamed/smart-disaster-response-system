import { describe, expect, it } from "vitest";
import {
  HAZARD_DESCRIPTION_MAX_LENGTH,
  HAZARD_DESCRIPTION_MIN_LENGTH,
  submitHazardReportSchema,
} from "./index";

const valid = {
  clientReportId: "11111111-1111-4111-8111-111111111111",
  hazardType: "FLOOD",
  description: "Flood water is crossing the main road.",
  photoRef: "photo://local/1.jpg",
  location: { latitude: 6.9271, longitude: 79.8612, source: "GPS" },
};

describe("submitHazardReportSchema", () => {
  it("accepts a valid report and trims the description", () => {
    const parsed = submitHazardReportSchema.parse({
      ...valid,
      description: "  Water on the road  ",
    });
    expect(parsed.description).toBe("Water on the road");
  });

  it("accepts descriptions of exactly the minimum and maximum length", () => {
    const min = "a".repeat(HAZARD_DESCRIPTION_MIN_LENGTH);
    const max = "a".repeat(HAZARD_DESCRIPTION_MAX_LENGTH);
    expect(submitHazardReportSchema.safeParse({ ...valid, description: min }).success).toBe(true);
    expect(submitHazardReportSchema.safeParse({ ...valid, description: max }).success).toBe(true);
  });

  it("rejects too-short, too-long and whitespace-only descriptions", () => {
    for (const description of ["too short", "a".repeat(501), " ".repeat(20)]) {
      expect(submitHazardReportSchema.safeParse({ ...valid, description }).success).toBe(false);
    }
  });

  it("rejects bad hazard type, missing photo and invalid coordinates", () => {
    expect(submitHazardReportSchema.safeParse({ ...valid, hazardType: "EARTHQUAKE" }).success).toBe(
      false,
    );
    expect(submitHazardReportSchema.safeParse({ ...valid, photoRef: "  " }).success).toBe(false);
    expect(
      submitHazardReportSchema.safeParse({
        ...valid,
        location: { latitude: 120, longitude: 0, source: "GPS" },
      }).success,
    ).toBe(false);
  });

  it("strips fields the client must never control", () => {
    const parsed = submitHazardReportSchema.parse({
      ...valid,
      status: "VERIFIED",
      reporterId: "x",
    });
    expect(parsed).not.toHaveProperty("status");
    expect(parsed).not.toHaveProperty("reporterId");
  });
});

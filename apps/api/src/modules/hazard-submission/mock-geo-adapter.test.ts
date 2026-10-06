import { describe, expect, it } from "vitest";
import {
  createSeedGeoAdapter,
  SEED_DISTRICT_ID,
  SEED_VOLUNTEER_AREA_ID,
} from "./mock-geo-adapter.js";

describe("MockGeoAdapter", () => {
  const geo = createSeedGeoAdapter();

  it("resolves every location to the default district", () => {
    expect(geo.resolveDistrictId()).toBe(SEED_DISTRICT_ID);
  });

  it("knows inside, outside and exact-boundary points", () => {
    expect(geo.isInsideArea(SEED_VOLUNTEER_AREA_ID, 6.9271, 79.8612)).toBe(true);
    expect(geo.isInsideArea(SEED_VOLUNTEER_AREA_ID, 7.05, 79.95)).toBe(true);
    expect(geo.isInsideArea(SEED_VOLUNTEER_AREA_ID, 6.8, 79.8)).toBe(true);
    expect(geo.isInsideArea(SEED_VOLUNTEER_AREA_ID, 7.0501, 79.9)).toBe(false);
    expect(geo.isInsideArea(SEED_VOLUNTEER_AREA_ID, 7.29, 80.63)).toBe(false);
  });

  it("treats an unknown area id as outside", () => {
    expect(geo.isInsideArea("unknown-area", 6.9271, 79.8612)).toBe(false);
  });
});

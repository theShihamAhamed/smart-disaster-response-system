import type { GeoAdapter } from "./types.js";

export interface BoundingBox {
  readonly minLatitude: number;
  readonly maxLatitude: number;
  readonly minLongitude: number;
  readonly maxLongitude: number;
}

/**
 * MOCK geo adapter for the assignment. There is no District/Area table yet, so:
 * - every location resolves to one default district, and
 * - an "assigned area" is a rectangle looked up by its id.
 * A point exactly on the rectangle's edge counts as INSIDE (assumed boundary rule - confirm with the team).
 */
export class MockGeoAdapter implements GeoAdapter {
  public constructor(
    private readonly defaultDistrictId: string,
    private readonly areas: ReadonlyMap<string, BoundingBox>,
  ) {}

  public resolveDistrictId(): string {
    return this.defaultDistrictId;
  }

  public isInsideArea(areaId: string, latitude: number, longitude: number): boolean {
    const box = this.areas.get(areaId);
    if (!box) {
      return false;
    }
    return (
      latitude >= box.minLatitude &&
      latitude <= box.maxLatitude &&
      longitude >= box.minLongitude &&
      longitude <= box.maxLongitude
    );
  }
}

// These two ids are the demo district / volunteer area used by prisma/seed.ts.
export const SEED_DISTRICT_ID = "00000000-0000-4000-8000-000000000001";
export const SEED_VOLUNTEER_AREA_ID = "00000000-0000-4000-8000-000000000002";

export function createSeedGeoAdapter(): MockGeoAdapter {
  return new MockGeoAdapter(
    SEED_DISTRICT_ID,
    new Map([
      [
        SEED_VOLUNTEER_AREA_ID,
        { minLatitude: 6.8, maxLatitude: 7.05, minLongitude: 79.8, maxLongitude: 79.95 },
      ],
    ]),
  );
}

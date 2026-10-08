import type { Coordinates } from "../types";

export interface MapRegion {
  readonly minLatitude: number;
  readonly maxLatitude: number;
  readonly minLongitude: number;
  readonly maxLongitude: number;
}

export interface Size {
  readonly width: number;
  readonly height: number;
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

/**
 * MOCK map adapter (the architecture calls for one). It is a flat rectangle covering the
 * Western Province. Swap it for a real map library later without touching the rest of the app.
 */
export const DEFAULT_MAP_REGION: MapRegion = {
  minLatitude: 6.5,
  maxLatitude: 7.3,
  minLongitude: 79.7,
  maxLongitude: 80.3,
};

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

/** Turns a tap on the map into coordinates. Top of the map = north. Taps outside are clamped. */
export function pointToCoordinates(
  point: Point,
  size: Size,
  region: MapRegion = DEFAULT_MAP_REGION,
): Coordinates {
  const x = clamp(point.x / size.width, 0, 1);
  const y = clamp(point.y / size.height, 0, 1);
  return {
    latitude: round(region.maxLatitude - y * (region.maxLatitude - region.minLatitude)),
    longitude: round(region.minLongitude + x * (region.maxLongitude - region.minLongitude)),
  };
}

/** The opposite: where on the map should the pin be drawn? */
export function coordinatesToPoint(
  coordinates: Coordinates,
  size: Size,
  region: MapRegion = DEFAULT_MAP_REGION,
): Point {
  const x =
    (coordinates.longitude - region.minLongitude) / (region.maxLongitude - region.minLongitude);
  const y = (region.maxLatitude - coordinates.latitude) / (region.maxLatitude - region.minLatitude);
  return { x: clamp(x, 0, 1) * size.width, y: clamp(y, 0, 1) * size.height };
}

function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

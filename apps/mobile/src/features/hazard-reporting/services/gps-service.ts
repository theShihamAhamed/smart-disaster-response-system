import { latitudeSchema, longitudeSchema } from "@disaster/shared-validation";
import type { GpsProvider } from "../ports/gps-provider";
import type { Coordinates } from "../types";

export type GpsFailureReason = "PERMISSION_DENIED" | "UNAVAILABLE" | "INVALID_POSITION" | "TIMEOUT";

export type GpsCapture =
  | { readonly kind: "OK"; readonly position: Coordinates }
  | { readonly kind: "FAILED"; readonly reason: GpsFailureReason };

export const DEFAULT_GPS_TIMEOUT_MS = 15_000;

/** Waits for `work`, but gives up with "TIMEOUT" after `timeoutMs`. The timer is always cleaned up. */
function raceWithTimeout<T>(work: Promise<T>, timeoutMs: number): Promise<T | "TIMEOUT"> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve("TIMEOUT"), timeoutMs);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/** Asks the phone for its position and checks it. It never throws: a failure is a normal result. */
export async function captureGpsLocation(
  provider: GpsProvider,
  timeoutMs: number = DEFAULT_GPS_TIMEOUT_MS,
): Promise<GpsCapture> {
  let reading;
  try {
    reading = await raceWithTimeout(provider.getCurrentPosition(), timeoutMs);
  } catch {
    return { kind: "FAILED", reason: "UNAVAILABLE" };
  }

  if (reading === "TIMEOUT") {
    return { kind: "FAILED", reason: "TIMEOUT" };
  }
  if (reading.status === "PERMISSION_DENIED") {
    return { kind: "FAILED", reason: "PERMISSION_DENIED" };
  }
  if (reading.status === "UNAVAILABLE") {
    return { kind: "FAILED", reason: "UNAVAILABLE" };
  }
  const valid =
    latitudeSchema.safeParse(reading.latitude).success &&
    longitudeSchema.safeParse(reading.longitude).success;
  return valid
    ? { kind: "OK", position: { latitude: reading.latitude, longitude: reading.longitude } }
    : { kind: "FAILED", reason: "INVALID_POSITION" };
}

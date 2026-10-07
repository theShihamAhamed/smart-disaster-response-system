import { afterEach, describe, expect, it, vi } from "vitest";
import { captureGpsLocation } from "../services/gps-service";
import { FakeGps } from "../testing/fakes";

afterEach(() => {
  vi.useRealTimers();
});

describe("captureGpsLocation", () => {
  it("returns the position when GPS works", async () => {
    const result = await captureGpsLocation(new FakeGps());
    expect(result).toEqual({ kind: "OK", position: { latitude: 6.9271, longitude: 79.8612 } });
  });

  it("reports a denied permission", async () => {
    const gps = new FakeGps();
    gps.reading = { status: "PERMISSION_DENIED" };
    expect(await captureGpsLocation(gps)).toEqual({ kind: "FAILED", reason: "PERMISSION_DENIED" });
  });

  it("reports an unavailable position", async () => {
    const gps = new FakeGps();
    gps.reading = { status: "UNAVAILABLE" };
    expect(await captureGpsLocation(gps)).toEqual({ kind: "FAILED", reason: "UNAVAILABLE" });
  });

  it("turns a crash inside the provider into UNAVAILABLE instead of throwing", async () => {
    const gps = new FakeGps();
    gps.failWith = new Error("location services are off");
    expect(await captureGpsLocation(gps)).toEqual({ kind: "FAILED", reason: "UNAVAILABLE" });
  });

  it("rejects a position that is not a real place", async () => {
    const gps = new FakeGps();
    gps.reading = { status: "OK", latitude: 120, longitude: 79 };
    expect(await captureGpsLocation(gps)).toEqual({ kind: "FAILED", reason: "INVALID_POSITION" });
    gps.reading = { status: "OK", latitude: 6, longitude: Number.NaN };
    expect(await captureGpsLocation(gps)).toEqual({ kind: "FAILED", reason: "INVALID_POSITION" });
  });

  it("gives up when GPS takes too long", async () => {
    vi.useFakeTimers();
    const gps = new FakeGps();
    gps.getCurrentPosition = () => new Promise(() => undefined); // never answers
    const pending = captureGpsLocation(gps, 5_000);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await pending).toEqual({ kind: "FAILED", reason: "TIMEOUT" });
  });
});

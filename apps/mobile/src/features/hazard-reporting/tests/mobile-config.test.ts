import { describe, expect, it } from "vitest";
import { DEFAULT_REQUEST_TIMEOUT_MS, readMobileConfig } from "../config";

describe("readMobileConfig", () => {
  it("falls back to the local API when nothing is set", () => {
    expect(readMobileConfig({})).toEqual({
      apiBaseUrl: "http://localhost:4000/api/v1",
      devUserId: null,
      requestTimeoutMs: DEFAULT_REQUEST_TIMEOUT_MS,
    });
  });

  it("reads the address and development user, and removes trailing slashes", () => {
    const config = readMobileConfig({
      EXPO_PUBLIC_API_BASE_URL: " http://192.168.1.5:4000/api/v1/// ",
      EXPO_PUBLIC_DEV_USER_ID: "10000000-0000-4000-8000-000000000001",
    });
    expect(config).toMatchObject({
      apiBaseUrl: "http://192.168.1.5:4000/api/v1",
      devUserId: "10000000-0000-4000-8000-000000000001",
    });
  });

  it("treats blank values as not set", () => {
    expect(
      readMobileConfig({ EXPO_PUBLIC_API_BASE_URL: "  ", EXPO_PUBLIC_DEV_USER_ID: " " }),
    ).toMatchObject({
      apiBaseUrl: "http://localhost:4000/api/v1",
      devUserId: null,
    });
  });

  it("stops with a clear message for a bad address", () => {
    expect(() => readMobileConfig({ EXPO_PUBLIC_API_BASE_URL: "not a url" })).toThrow(
      /full web address/,
    );
    expect(() => readMobileConfig({ EXPO_PUBLIC_API_BASE_URL: "ftp://host/api" })).toThrow(/http/);
  });

  it("stops with a clear message for a bad user id", () => {
    expect(() => readMobileConfig({ EXPO_PUBLIC_DEV_USER_ID: "abc" })).toThrow(/user id/);
  });
});

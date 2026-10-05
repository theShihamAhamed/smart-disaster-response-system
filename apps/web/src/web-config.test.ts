import { describe, expect, it } from "vitest";

import { readWebConfig } from "./web-config";

describe("web configuration", () => {
  it("reads and normalizes the API base URL", () => {
    expect(readWebConfig({ VITE_API_BASE_URL: "  http://localhost:4000/api/v1/  " })).toEqual({
      apiBaseUrl: "http://localhost:4000/api/v1",
    });
  });

  it("rejects a missing API base URL", () => {
    expect(() => readWebConfig({})).toThrow(
      "VITE_API_BASE_URL is required for the officer web application.",
    );
  });

  it.each(["localhost:4000/api/v1", "ftp://localhost/api/v1", "https://api.test/v1?q=1"])(
    "rejects invalid API base URL %s",
    (apiBaseUrl) => {
      expect(() => readWebConfig({ VITE_API_BASE_URL: apiBaseUrl })).toThrow(/VITE_API_BASE_URL/);
    },
  );

  it("accepts an optional development user UUID", () => {
    expect(
      readWebConfig({
        VITE_API_BASE_URL: "https://api.example.test/api/v1",
        VITE_DEV_USER_ID: " 11111111-1111-4111-8111-111111111111 ",
      }),
    ).toEqual({
      apiBaseUrl: "https://api.example.test/api/v1",
      devUserId: "11111111-1111-4111-8111-111111111111",
    });
  });

  it("treats an empty development user ID as absent", () => {
    expect(
      readWebConfig({
        VITE_API_BASE_URL: "https://api.example.test/api/v1",
        VITE_DEV_USER_ID: "   ",
      }),
    ).toEqual({ apiBaseUrl: "https://api.example.test/api/v1" });
  });

  it("rejects a malformed development user ID", () => {
    expect(() =>
      readWebConfig({
        VITE_API_BASE_URL: "https://api.example.test/api/v1",
        VITE_DEV_USER_ID: "district-officer",
      }),
    ).toThrow("VITE_DEV_USER_ID must be a valid UUID when provided.");
  });
});

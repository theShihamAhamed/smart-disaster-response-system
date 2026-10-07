import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

afterEach(() => {
  cleanup();
});

vi.stubEnv("VITE_API_BASE_URL", "http://localhost:4000/api/v1");

import react from "@vitejs/plugin-react";
import { defineConfig, mergeConfig } from "vitest/config";
import base from "../../vitest.base";

export default mergeConfig(
  base,
  defineConfig({
    plugins: [react()],
    test: {
      environment: "jsdom",
      setupFiles: ["./src/test-setup.ts"],
      coverage: {
        exclude: ["src/main.tsx", "src/test-setup.ts", "**/*.config.ts", "dist/**"],
      },
    },
  }),
);
